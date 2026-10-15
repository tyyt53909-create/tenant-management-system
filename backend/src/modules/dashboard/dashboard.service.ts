import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DashboardStats {
  totalRooms: number;
  totalTenants: number;
  activeContracts: number;
  pendingBills: number;
  vacantRooms: number;
  occupiedRooms: number;
  maintenanceRequests: number;
}

export interface RevenueTrendItem {
  /** 格式 YYYY-MM */
  month: string;
  /** 收入金额（单位：分） */
  revenue: number;
}

export interface RoomStatusItem {
  status: string;
  count: number;
}

/** 未完结的报修状态（用于「待处理报修」统计） */
const OPEN_MAINTENANCE_STATUSES = [
  'SUBMITTED',
  'ACKNOWLEDGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_CONFIRM',
] as const;

/** 未缴清的账单状态（用于「待缴账单」统计） */
const UNPAID_BILL_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE'] as const;

const ROOM_STATUS_ORDER = ['VACANT', 'RESERVED', 'OCCUPIED', 'MAINTENANCE'] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 首页统计卡片数据
   */
  async getStats(): Promise<DashboardStats> {
    const [
      totalRooms,
      vacantRooms,
      occupiedRooms,
      totalTenants,
      activeContracts,
      pendingBills,
      maintenanceRequests,
    ] = await Promise.all([
      this.prisma.room.count(),
      this.prisma.room.count({ where: { status: 'VACANT' } }),
      this.prisma.room.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.contract.count({ where: { status: 'ACTIVE' } }),
      this.prisma.bill.count({ where: { status: { in: [...UNPAID_BILL_STATUSES] } } }),
      this.prisma.maintenanceRequest.count({
        where: { status: { in: [...OPEN_MAINTENANCE_STATUSES] } },
      }),
    ]);

    return {
      totalRooms,
      totalTenants,
      activeContracts,
      pendingBills,
      vacantRooms,
      occupiedRooms,
      maintenanceRequests,
    };
  }

  /**
   * 近 N 个月收入趋势（按 PaymentRecord.paidAt 归月汇总，单位：分）
   * 无收入的月份补 0，返回顺序为从最早到当前月
   */
  async getRevenueTrend(months = 6): Promise<RevenueTrendItem[]> {
    const safeMonths = Math.min(Math.max(Math.trunc(Number(months)) || 6, 1), 24);
    const now = new Date();

    const buckets = new Map<string, number>();
    for (let i = 0; i < safeMonths; i++) {
      const monthDate = new Date(
        now.getFullYear(),
        now.getMonth() - (safeMonths - 1) + i,
        1,
      );
      buckets.set(this.formatMonth(monthDate), 0);
    }

    const rangeStart = new Date(now.getFullYear(), now.getMonth() - (safeMonths - 1), 1);

    const payments = await this.prisma.paymentRecord.findMany({
      where: { paidAt: { gte: rangeStart } },
      select: { amount: true, paidAt: true },
    });

    for (const payment of payments) {
      const monthKey = this.formatMonth(new Date(payment.paidAt));
      const current = buckets.get(monthKey);
      if (current !== undefined) {
        buckets.set(monthKey, current + payment.amount);
      }
    }

    return Array.from(buckets, ([month, revenue]) => ({ month, revenue }));
  }

  /**
   * 房源状态分布（固定返回四种状态，无数据补 0）
   */
  async getRoomStatus(): Promise<RoomStatusItem[]> {
    const grouped = await this.prisma.room.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const counts = new Map<string, number>(
      grouped.map((group) => [group.status as string, group._count._all]),
    );

    return ROOM_STATUS_ORDER.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    }));
  }

  private formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
