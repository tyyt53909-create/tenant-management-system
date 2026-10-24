import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: BusinessClock, useValue: new BusinessClock(new ConfigService({})) },
        {
          provide: PrismaService,
          useValue: {
            room: {
              count: vi.fn(),
              groupBy: vi.fn(),
            },
            tenant: { count: vi.fn() },
            contract: { count: vi.fn() },
            bill: { count: vi.fn() },
            maintenanceRequest: { count: vi.fn() },
            paymentRecord: { findMany: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getStats', () => {
    it('应该聚合全部统计指标，并对房态/账单/报修带上筛选条件', async () => {
      vi.spyOn(prisma.room, 'count')
        .mockResolvedValueOnce(10) // totalRooms
        .mockResolvedValueOnce(4) // vacantRooms
        .mockResolvedValueOnce(6); // occupiedRooms
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(8);
      vi.spyOn(prisma.contract, 'count').mockResolvedValue(5);
      vi.spyOn(prisma.bill, 'count').mockResolvedValue(3);
      vi.spyOn(prisma.maintenanceRequest, 'count').mockResolvedValue(2);

      const result = await service.getStats();

      expect(result).toEqual({
        totalRooms: 10,
        totalTenants: 8,
        activeContracts: 5,
        pendingBills: 3,
        vacantRooms: 4,
        occupiedRooms: 6,
        maintenanceRequests: 2,
      });

      expect(prisma.room.count).toHaveBeenNthCalledWith(1);
      expect(prisma.room.count).toHaveBeenNthCalledWith(2, {
        where: { status: 'VACANT' },
      });
      expect(prisma.room.count).toHaveBeenNthCalledWith(3, {
        where: { status: 'OCCUPIED' },
      });
      expect(prisma.tenant.count).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(prisma.contract.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
      expect(prisma.bill.count).toHaveBeenCalledWith({
        where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
      });
      expect(prisma.maintenanceRequest.count).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['SUBMITTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM'],
          },
        },
      });
    });
  });

  describe('getRevenueTrend', () => {
    it('应该按月份归集收款金额，并补齐无收入的月份', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-15T10:00:00+08:00'));

      vi.spyOn(prisma.paymentRecord, 'findMany').mockResolvedValue([
        { amount: 100000, paidAt: new Date('2026-10-01T09:00:00+08:00') },
        { amount: 50000, paidAt: new Date('2026-10-20T09:00:00+08:00') },
        { amount: 30000, paidAt: new Date('2026-06-15T09:00:00+08:00') },
      ] as any);

      const result = await service.getRevenueTrend(6);

      expect(result).toHaveLength(6);
      expect(result.map((item) => item.month)).toEqual([
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
      ]);
      expect(result[0]).toEqual({ month: '2026-05', revenue: 0 });
      expect(result[1]).toEqual({ month: '2026-06', revenue: 30000 });
      expect(result[5]).toEqual({ month: '2026-10', revenue: 150000 });

      // 查询起点应为范围首月（业务日 UTC 零点）
      const findManyArgs = vi.mocked(prisma.paymentRecord.findMany).mock.calls[0][0] as any;
      expect(findManyArgs.where.paidAt.gte).toEqual(new Date(Date.UTC(2026, 4, 1)));
    });

    it('超出范围的收款月份不应计入（防御式处理）', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-15T10:00:00+08:00'));

      vi.spyOn(prisma.paymentRecord, 'findMany').mockResolvedValue([
        { amount: 999, paidAt: new Date('2025-12-01T09:00:00+08:00') },
      ] as any);

      const result = await service.getRevenueTrend(6);

      expect(result.every((item) => item.revenue === 0)).toBe(true);
    });

    it('非法或越界的 months 应回退/收敛到 1~24 之间', async () => {
      vi.spyOn(prisma.paymentRecord, 'findMany').mockResolvedValue([] as any);

      expect(await service.getRevenueTrend(0)).toHaveLength(6); // 0 视为默认 6
      expect(await service.getRevenueTrend(NaN as any)).toHaveLength(6);
      expect(await service.getRevenueTrend(-5)).toHaveLength(1);
      expect(await service.getRevenueTrend(100)).toHaveLength(24);
    });
  });

  describe('getRoomStatus', () => {
    it('应该返回四种房态，无数据补 0', async () => {
      vi.spyOn(prisma.room, 'groupBy').mockResolvedValue([
        { status: 'VACANT', _count: { _all: 3 } },
        { status: 'OCCUPIED', _count: { _all: 2 } },
      ] as any);

      const result = await service.getRoomStatus();

      expect(result).toEqual([
        { status: 'VACANT', count: 3 },
        { status: 'RESERVED', count: 0 },
        { status: 'OCCUPIED', count: 2 },
        { status: 'MAINTENANCE', count: 0 },
      ]);
    });

    it('无任何房源时应返回全 0', async () => {
      vi.spyOn(prisma.room, 'groupBy').mockResolvedValue([] as any);

      const result = await service.getRoomStatus();

      expect(result).toHaveLength(4);
      expect(result.every((item) => item.count === 0)).toBe(true);
    });
  });
});
