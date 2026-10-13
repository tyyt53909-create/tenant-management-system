import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryStatisticsDto } from './dto/query-statistics.dto.js';

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
  constructor(private readonly prisma: PrismaService) {}

  /** 依 period（+自定义区间）解析出 [start, end) */
  resolveRange(query: QueryStatisticsDto): PeriodRange {
    const now = new Date();

    if (query.period === 'CUSTOM') {
      if (!query.startDate || !query.endDate) {
        // 缺参数时回退为当月，避免 500
        return this.monthRange(now);
      }
      const start = new Date(query.startDate);
      const end = new Date(query.endDate);
      // end 取当天 23:59:59.999，使自定义区间为闭区间
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    if (query.period === 'QUARTER') {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }

    if (query.period === 'YEAR') {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      };
    }

    return this.monthRange(now);
  }

  private monthRange(now: Date): PeriodRange {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
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
          ...(query.buildingId ? { contract: { buildingId: query.buildingId } } : {}),
        },
        select: { amount: true, billType: true, status: true },
      }),
      this.prisma.maintenanceRequest.count({
        where: {
          createdAt: { gte: range.start, lte: range.end },
          ...(query.buildingId ? { room: { buildingId: query.buildingId } } : {}),
        },
      }),
    ]);

    // 占用房间（存在 ACTIVE 合同）
    const occupiedIds = new Set(
      (
        await this.prisma.contract.findMany({
          where: {
            status: 'ACTIVE',
            roomId: { in: rooms.map((r) => r.id) },
          },
          select: { roomId: true },
        })
      ).map((c) => c.roomId),
    );

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const rentPaid = sum(payments.filter((p) => p.bill.billType === 'RENT').map((p) => p.amount));
    const utilityPaid = sum(
      payments.filter((p) => p.bill.billType === 'UTILITY').map((p) => p.amount),
    );
    const rentBilled = sum(bills.filter((b) => b.billType === 'RENT').map((b) => b.amount));
    const utilityBilled = sum(bills.filter((b) => b.billType === 'UTILITY').map((b) => b.amount));
    const overdueCount = bills.filter((b) => b.status === 'OVERDUE').length;

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
      collectionRate:
        rentBilled + utilityBilled > 0
          ? Number((((rentPaid + utilityPaid) / (rentBilled + utilityBilled)) * 100).toFixed(1))
          : null,
      overdueCount,
      maintenanceCount: maintenance,
      roomTotal: total,
      roomOccupied: occupied,
      occupancyRate: total > 0 ? Number(((occupied / total) * 100).toFixed(1)) : 0,
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
          occupancyRate:
            floorRooms.length > 0
              ? Number(((floorOccupied / floorRooms.length) * 100).toFixed(1))
              : 0,
        };
      });
      return { summary, dimension: 'FLOOR', byFloor };
    }

    return { summary, dimension: 'BUILDING', byFloor: [] };
  }
}
