import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { RentReportDto } from './dto/rent-report.dto.js';
import { RentReportResponseDto } from './dto/rent-report-response.dto.js';
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

  /** 管理口径：原收款、成功退款及纯更正分别按其业务月归集。 */
  async rentReport(query: RentReportDto): Promise<RentReportResponseDto> {
    const [year, month] = query.month.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1) - 2 * 86400000);
    const end = new Date(Date.UTC(year, month, 1) + 2 * 86400000);
    const dateStart = this.clock.parseDateOnly(`${query.month}-01`)!;
    const dateEnd = this.clock.addMonths(dateStart, 1);
    const today = this.clock.todayUtc();
    const rentBill = { billType: 'RENT' as const, contract: { buildingId: query.buildingId } };
    const [payments, refunds, undatedRefunds, reversals, orphanVoids, rooms, paidExpenses] = await Promise.all([
      this.prisma.paymentRecord.findMany({
        where: { paidAt: { gte: start, lt: end }, status: { in: ['CONFIRMED', 'VOIDED'] }, bill: rentBill },
        select: { paidAt: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true },
      }),
      this.prisma.refundRecord.findMany({
        where: { status: 'SUCCESS', successAt: { gte: start, lt: end }, bill: rentBill },
        select: { amount: true, successAt: true, paymentRecord: { select: { id: true, billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true } }, reversal: { select: { billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true } } },
      }),
      // 没有完成时间不能确定受影响月份；不可凭创建/更新时间猜测。
      this.prisma.refundRecord.count({ where: { status: 'SUCCESS', successAt: null, bill: rentBill } }),
      this.prisma.paymentRecord.findMany({
        where: { status: 'REVERSAL', refundReversalId: null, paidAt: { gte: start, lt: end }, bill: rentBill },
        select: { paidAt: true, amount: true, billPortion: true, lateFeePortion: true, reversalOf: { select: { billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true, refundRecords: { select: { id: true } } } }, billId: true },
      }),
      this.prisma.paymentRecord.findMany({ where: { status: 'VOIDED', reversal: null, bill: rentBill }, select: { voidedAt: true, amount: true, refundRecords: { where: { status: 'SUCCESS' }, select: { amount: true, reversal: { select: { amount: true, allocationVerified: true } } } } } }),
      this.prisma.room.findMany({ where: { buildingId: query.buildingId }, select: { id: true } }),
      this.prisma.expensePayment.aggregate({ where: { paidDate: { gte: dateStart, lt: dateEnd, lte: today }, expense: { buildingId: query.buildingId, cancelledAt: null } }, _sum: { amount: true } }),
    ]);
    const balance = await this.prisma.prepayAccount.aggregate({ where: { roomId: { in: rooms.map(room => room.id) } }, _sum: { balanceCache: true } });
    const monthlyPayments = payments.filter(p => this.clock.monthKey(p.paidAt) === query.month);
    const verifiedPayments = monthlyPayments.filter(p => p.allocationVerified === true && p.amount > 0 && p.billPortion >= 0 && p.lateFeePortion >= 0 && p.billPortion + p.lateFeePortion === p.amount);
    const unknownAllocationCount = monthlyPayments.length - verifiedPayments.length;
    const verifiedAllocationRentSubtotal = verifiedPayments.reduce((sum, p) => sum + p.billPortion, 0);
    let verifiedRefundSubtotal = 0;
    let verifiedCorrectionSubtotal = 0;
    let unknownAdjustmentCount = undatedRefunds + orphanVoids.filter(p => {
      const refundsAccountForVoid = p.refundRecords.length > 0 && p.refundRecords.every(r => r.reversal?.allocationVerified === true && r.reversal.amount === -r.amount) && p.refundRecords.reduce((sum, r) => sum + r.amount, 0) === p.amount;
      return !refundsAccountForVoid && (!p.voidedAt || this.clock.monthKey(p.voidedAt) === query.month);
    }).length;
    for (const refund of refunds) {
      if (!refund.successAt || this.clock.monthKey(refund.successAt) !== query.month) continue;
      const r = refund.reversal;
      if (!r || r.status !== 'REVERSAL' || r.billId !== refund.paymentRecord.billId || r.allocationVerified !== true || refund.paymentRecord.allocationVerified !== true || !['CONFIRMED', 'VOIDED'].includes(refund.paymentRecord.status) || r.amount !== -refund.amount || r.billPortion > 0 || r.lateFeePortion > 0 || r.billPortion + r.lateFeePortion !== r.amount || refund.amount > refund.paymentRecord.amount || refund.paymentRecord.billPortion < 0 || refund.paymentRecord.lateFeePortion < 0 || refund.paymentRecord.billPortion + refund.paymentRecord.lateFeePortion !== refund.paymentRecord.amount || -r.billPortion > refund.paymentRecord.billPortion || -r.lateFeePortion > refund.paymentRecord.lateFeePortion) { unknownAdjustmentCount++; continue; }
      verifiedRefundSubtotal -= r.billPortion;
    }
    for (const r of reversals) {
      if (this.clock.monthKey(r.paidAt) !== query.month) continue;
      const original = r.reversalOf;
      if (!original || original.billId !== r.billId || original.refundRecords.length > 0 || original.allocationVerified !== true || original.status !== 'VOIDED' || original.amount <= 0 || original.billPortion < 0 || original.lateFeePortion < 0 || original.billPortion + original.lateFeePortion !== original.amount || r.amount !== -original.amount || r.billPortion !== -original.billPortion || r.lateFeePortion !== -original.lateFeePortion) { unknownAdjustmentCount++; continue; }
      verifiedCorrectionSubtotal -= r.billPortion;
    }
    const complete = unknownAllocationCount === 0 && unknownAdjustmentCount === 0;
    const paidExpenseAmount = paidExpenses._sum.amount ?? 0;
    const subtotal = verifiedAllocationRentSubtotal - verifiedRefundSubtotal - verifiedCorrectionSubtotal;
    return {
      month: query.month, buildingId: query.buildingId,
      rentIncome: complete ? subtotal : null,
      verifiedAllocationRentSubtotal, verifiedRefundSubtotal, verifiedCorrectionSubtotal,
      unknownAllocationCount, unknownAdjustmentCount,
      paidExpenses: paidExpenseAmount,
      currentPrepayBalance: balance._sum.balanceCache ?? 0,
      status: complete ? 'complete' : 'incomplete',
      netOperatingIncome: complete ? subtotal - paidExpenseAmount : null,
      basis: '管理口径：租金本金按实收或预付抵扣月，成功退款按完成月，更正按发生月；扣除实付支出',
      limitations: [
        ...(unknownAllocationCount ? ['存在来源未核实的收款分配'] : []),
        ...(unknownAdjustmentCount ? ['存在退款或更正证据不足；无完成时间的退款可能影响任意月份'] : []),
        '当前预付余额不是月末余额；此报表不是税务或法定会计口径',
      ],
      hasRentAdjustments: refunds.length > 0 || reversals.length > 0 || undatedRefunds > 0 || orphanVoids.length > 0,
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
