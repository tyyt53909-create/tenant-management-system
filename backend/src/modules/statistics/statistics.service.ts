import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { RentReportDto } from './dto/rent-report.dto.js';
import { QueryStatisticsDto } from './dto/query-statistics.dto.js';
import { collectionRate, occupancyRate, sumAmounts } from '../../common/metrics/finance-metrics.js';

export interface PeriodRange {
  start: Date;
  end: Date;
}

/**
 * 统计（P1 / T155）
 *
 * 时间维度：当月 / 本季 / 本年 / 自定义
 * 空间维度：整楼 / 按楼层
 *
 * 口径说明（避免与仪表板混淆）：
 * - 收款额按 PaymentRecord.paidAt 落在区间内统计
 * - 出账额按 Bill.dueDate 落在区间内统计
 * - 出租率 = 区间末占用房间数 / 房间总数（占用 = 存在 ACTIVE 合同）
 * 不做同比环比（docs/09 §13 已确认）
 */
@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
  ) {}

  /** 管理口径：预付抵扣按收款实际业务月；退款及历史分配待核对。 */
  async rentReport(query: RentReportDto) {
    const [year, month] = query.month.split('-').map(Number);
    // 先取足以覆盖任何时区的候选区间，再由 BusinessClock 确认业务月。
    const start = new Date(Date.UTC(year, month - 1, 1) - 2 * 86400000);
    const end = new Date(Date.UTC(year, month, 1) + 2 * 86400000);
    const dateStart = this.clock.parseDateOnly(`${query.month}-01`)!;
    const dateEnd = this.clock.addMonths(dateStart, 1);
    const today = this.clock.todayUtc();
    const [payments, adjustments, rooms, paidExpenses] = await Promise.all([
      this.prisma.paymentRecord.findMany({
        where: { paidAt: { gte: start, lt: end }, status: 'CONFIRMED', bill: { billType: 'RENT', contract: { buildingId: query.buildingId } } },
        select: { paidAt: true, billPortion: true, allocationVerified: true },
      }),
      // 在口径确定前，只要该楼栋存在租金退款/冲正，即不宣称完整。
      this.prisma.paymentRecord.count({
        where: { bill: { billType: 'RENT', contract: { buildingId: query.buildingId } }, OR: [{ status: { in: ['VOIDED', 'REVERSAL'] } }, { refundRecords: { some: { status: { in: ['PROCESSING', 'SUCCESS'] } } } }] },
      }),
      this.prisma.room.findMany({ where: { buildingId: query.buildingId }, select: { id: true } }),
      this.prisma.expensePayment.aggregate({ where: { paidDate: { gte: dateStart, lt: dateEnd, lte: today }, expense: { buildingId: query.buildingId, cancelledAt: null } }, _sum: { amount: true } }),
    ]);
    const balance = await this.prisma.prepayAccount.aggregate({ where: { roomId: { in: rooms.map(room => room.id) } }, _sum: { balanceCache: true } });
    const monthlyPayments = payments.filter(p => this.clock.monthKey(p.paidAt) === query.month);
    return {
      month: query.month, buildingId: query.buildingId,
      rentIncome: null,
      provisionalRentIncome: monthlyPayments.filter(p => p.allocationVerified === true).reduce((sum, p) => sum + p.billPortion, 0),
      unknownAllocationCount: monthlyPayments.filter(p => p.allocationVerified !== true).length,
      paidExpenses: paidExpenses._sum.amount ?? 0,
      currentPrepayBalance: balance._sum.balanceCache ?? 0,
      status: 'incomplete',
      netOperatingIncome: null,
      basis: '管理口径：按租金本金实际收款或预付抵扣的业务月归集',
      limitations: ['退款和冲正归期尚待确定', '来源未核实的收款未计入候选租金，须核对', '当前预付余额不是月末余额；不计算净收益'],
      hasRentAdjustments: adjustments > 0,
    };
  }

  /** 依 period（+自定义区间）解析出 [start, end) */
  resolveRange(query: QueryStatisticsDto): PeriodRange {
    const today = this.clock.todayUtc();

    if (query.period === 'CUSTOM') {
      if (!query.startDate || !query.endDate) {
        // 缺参数时回退为当月，避免 500
        return this.monthRange(today);
      }
      const start = this.clock.parseDateOnly(query.startDate);
      const endDay = this.clock.parseDateOnly(query.endDate);
      if (!start || !endDay) {
        return this.monthRange(today);
      }
      // 自定义区间按业务日闭区间：[start 00:00, end 23:59:59.999]
      return { start, end: new Date(this.clock.addDays(endDay, 1).getTime() - 1) };
    }

    if (query.period === 'QUARTER') {
      return { start: this.clock.startOfQuarter(today), end: this.clock.endOfQuarter(today) };
    }

    if (query.period === 'YEAR') {
      return { start: this.clock.startOfYear(today), end: this.clock.endOfYear(today) };
    }

    return this.monthRange(today);
  }

  private monthRange(day: Date): PeriodRange {
    return { start: this.clock.startOfMonth(day), end: this.clock.endOfMonth(day) };
  }

  /** 统计总览 + 按空间维度分组 */
  async overview(query: QueryStatisticsDto) {
    const range = this.resolveRange(query);
    const roomWhere: Record<string, unknown> = {};
    if (query.buildingId) roomWhere.buildingId = query.buildingId;

    const [rooms, payments, bills, maintenance] = await Promise.all([
      this.prisma.room.findMany({
        where: roomWhere,
        select: { id: true, floor: true, roomNumber: true },
      }),
      this.prisma.paymentRecord.findMany({
        where: {
          paidAt: { gte: range.start, lte: range.end },
          ...(query.buildingId ? { bill: { contract: { buildingId: query.buildingId } } } : {}),
        },
        select: { amount: true, bill: { select: { billType: true } } },
      }),
      this.prisma.bill.findMany({
        where: {
          dueDate: { gte: range.start, lte: range.end },
          // 已取消的账单不计入出账额（T207）：否则 collectionRate 的分母被灌水，
          // 且与 dashboard/management-summary 明确使用 status:{not:'CANCELLED'} 的口径互相矛盾
          status: { not: 'CANCELLED' },
          ...(query.buildingId ? { contract: { buildingId: query.buildingId } } : {}),
        },
        select: { amount: true, billType: true, status: true, isOverdue: true },
      }),
      this.prisma.maintenanceRequest.count({
        where: {
          createdAt: { gte: range.start, lte: range.end },
          ...(query.buildingId ? { room: { buildingId: query.buildingId } } : {}),
        },
      }),
    ]);

    // 占用房间：按「统计区间的末端」计算（T207 修正）。
    // 原实现只查 status='ACTIVE'（当下的状态），把它用在历史区间报表上会串台：
    // 查 1 月报表却返回今天的占用数。现在改用合同有效期覆盖该时刻：
    // 区间末端若在未来（本月/本季报表），以「当前时刻」为准，避免出现前瞻性的空档。
    const asOf = range.end.getTime() > this.clock.now().getTime() ? this.clock.now() : range.end;
    const occupiedIds = new Set(
      (
        await this.prisma.contract.findMany({
          where: {
            status: { in: ['ACTIVE', 'EXPIRED', 'RENEWED'] },
            startDate: { lte: asOf },
            endDate: { gte: asOf },
            roomId: { in: rooms.map((r) => r.id) },
          },
          select: { roomId: true },
        })
      ).map((c) => c.roomId),
    );

    const rentPaid = sumAmounts(
      payments.filter((p) => p.bill.billType === 'RENT'),
      (p) => p.amount,
    );
    const utilityPaid = sumAmounts(
      payments.filter((p) => p.bill.billType === 'UTILITY'),
      (p) => p.amount,
    );
    const rentBilled = sumAmounts(
      bills.filter((b) => b.billType === 'RENT'),
      (b) => b.amount,
    );
    const utilityBilled = sumAmounts(
      bills.filter((b) => b.billType === 'UTILITY'),
      (b) => b.amount,
    );
    const overdueCount = bills.filter((b) => b.isOverdue).length;

    const total = rooms.length;
    const occupied = rooms.filter((r) => occupiedIds.has(r.id)).length;

    const summary = {
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      period: query.period ?? 'MONTH',
      rentBilled,
      rentPaid,
      utilityBilled,
      utilityPaid,
      totalBilled: rentBilled + utilityBilled,
      totalPaid: rentPaid + utilityPaid,
      collectionRate: collectionRate(rentBilled + utilityBilled, rentPaid + utilityPaid),
      overdueCount,
      maintenanceCount: maintenance,
      roomTotal: total,
      roomOccupied: occupied,
      occupancyRate: occupancyRate(occupied, total),
    };

    // 空间维度：整楼（单组）或按楼层分组
    if (query.dimension === 'FLOOR') {
      const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
      const byFloor = floors.map((floor) => {
        const floorRooms = rooms.filter((r) => r.floor === floor);
        const floorOccupied = floorRooms.filter((r) => occupiedIds.has(r.id)).length;
        return {
          floor,
          roomTotal: floorRooms.length,
          roomOccupied: floorOccupied,
          occupancyRate: occupancyRate(floorOccupied, floorRooms.length),
        };
      });
      return { summary, dimension: 'FLOOR', byFloor };
    }

    return { summary, dimension: 'BUILDING', byFloor: [] };
  }
}
