import { Test, TestingModule } from '@nestjs/testing';
import { StatisticsService } from './statistics.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('StatisticsService（统计 P1 / T155）', () => {
  let service: StatisticsService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      room: { findMany: vi.fn().mockResolvedValue([]) },
      paymentRecord: { findMany: vi.fn().mockResolvedValue([]) },
      bill: { findMany: vi.fn().mockResolvedValue([]) },
      maintenanceRequest: { count: vi.fn().mockResolvedValue(0) },
      contract: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<StatisticsService>(StatisticsService);
    prisma = prismaMock;
  });

  describe('resolveRange 时间维度', () => {
    it('默认当月：从月初到月末', () => {
      const { start, end } = service.resolveRange({ period: 'MONTH' } as any);
      expect(start.getDate()).toBe(1);
      expect(start.getHours()).toBe(0);
      // 月末：下月 0 日
      expect(end.getMonth()).toBe(start.getMonth());
      expect(end.getDate()).toBe(new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate());
    });

    it('本季：从季度首月 1 号到末月最后一天', () => {
      const { start, end } = service.resolveRange({ period: 'QUARTER' } as any);
      expect([0, 3, 6, 9]).toContain(start.getMonth());
      expect(start.getDate()).toBe(1);
      expect(end.getMonth()).toBe(start.getMonth() + 2);
    });

    it('本年：1 月 1 日到 12 月 31 日', () => {
      const { start, end } = service.resolveRange({ period: 'YEAR' } as any);
      expect(start.getMonth()).toBe(0);
      expect(start.getDate()).toBe(1);
      expect(end.getMonth()).toBe(11);
      expect(end.getDate()).toBe(31);
    });

    it('自定义区间：end 取当天 23:59:59.999（闭区间）', () => {
      const { start, end } = service.resolveRange({
        period: 'CUSTOM',
        startDate: '2026-01-01',
        endDate: '2026-03-15',
      } as any);
      expect(start.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(end.toISOString().slice(0, 10)).toBe('2026-03-15');
      expect(end.getHours()).toBe(23);
    });

    it('自定义缺参数时回退当月（不抛错）', () => {
      const { start } = service.resolveRange({ period: 'CUSTOM' } as any);
      expect(start.getDate()).toBe(1);
    });
  });

  describe('overview 汇总', () => {
    it('汇总出账/收款并计算收缴率与出租率', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', floor: 1, roomNumber: '101' },
        { id: 'r2', floor: 1, roomNumber: '102' },
        { id: 'r3', floor: 2, roomNumber: '201' },
      ]);
      prisma.paymentRecord.findMany.mockResolvedValue([
        { amount: 300000, bill: { billType: 'RENT' } },
        { amount: 50000, bill: { billType: 'UTILITY' } },
      ]);
      prisma.bill.findMany.mockResolvedValue([
        { amount: 400000, billType: 'RENT', status: 'PENDING' },
        { amount: 100000, billType: 'UTILITY', status: 'OVERDUE' },
      ]);
      prisma.maintenanceRequest.count.mockResolvedValue(2);
      prisma.contract.findMany.mockResolvedValue([{ roomId: 'r1' }]);

      const res = await service.overview({ period: 'MONTH', dimension: 'BUILDING' } as any);

      expect(res.summary.rentBilled).toBe(400000);
      expect(res.summary.rentPaid).toBe(300000);
      expect(res.summary.utilityBilled).toBe(100000);
      expect(res.summary.totalBilled).toBe(500000);
      expect(res.summary.totalPaid).toBe(350000);
      expect(res.summary.collectionRate).toBe(70); // 350000 / 500000
      expect(res.summary.overdueCount).toBe(1);
      expect(res.summary.maintenanceCount).toBe(2);
      expect(res.summary.roomTotal).toBe(3);
      expect(res.summary.roomOccupied).toBe(1);
      expect(res.summary.occupancyRate).toBe(33.3);
      expect(res.dimension).toBe('BUILDING');
      expect(res.byFloor).toEqual([]);
    });

    it('无账单时收缴率为 null（不产生除零）', async () => {
      const res = await service.overview({ period: 'MONTH' } as any);
      expect(res.summary.collectionRate).toBeNull();
      expect(res.summary.totalBilled).toBe(0);
    });

    it('出账额排除已取消账单（T207：原先把 CANCELLED 也计入，收缴率被拉低）', async () => {
      await service.overview({ period: 'MONTH' } as any);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'CANCELLED' } }),
        }),
      );
    });

    it('出租率按「区间末端」计算：历史区间用区间末，未到的区间以当下为准（T207）', async () => {
      await service.overview({
        period: 'CUSTOM',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      } as any);

      const where = prisma.contract.findMany.mock.calls.at(-1)[0].where;
      // 历史区间：基准时刻是区间末端（在过去），而不是 now
      expect(where.endDate.gte.getTime()).toBeLessThan(Date.now());
      expect(where.startDate.lte.getTime()).toBeLessThanOrEqual(where.endDate.gte.getTime());
      expect(where.status).toEqual({ in: ['ACTIVE', 'EXPIRED', 'RENEWED'] });
    });

    it('本月报表的占用基准落在当下（不会把月末当成未来空档）', async () => {
      await service.overview({ period: 'MONTH' } as any);

      const where = prisma.contract.findMany.mock.calls.at(-1)[0].where;
      const asOf = where.endDate.gte.getTime();
      const now = Date.now();
      // 与当前时刻相差不超过 5 秒
      expect(Math.abs(now - asOf)).toBeLessThan(5000);
    });

    it('dimension=FLOOR 时按楼层分组并给出各层出租率', async () => {
      prisma.room.findMany.mockResolvedValue([
        { id: 'r1', floor: 1, roomNumber: '101' },
        { id: 'r2', floor: 1, roomNumber: '102' },
        { id: 'r3', floor: 2, roomNumber: '201' },
      ]);
      prisma.contract.findMany.mockResolvedValue([{ roomId: 'r1' }, { roomId: 'r3' }]);

      const res = await service.overview({ period: 'MONTH', dimension: 'FLOOR' } as any);

      expect(res.dimension).toBe('FLOOR');
      expect(res.byFloor).toEqual([
        { floor: 1, roomTotal: 2, roomOccupied: 1, occupancyRate: 50 },
        { floor: 2, roomTotal: 1, roomOccupied: 1, occupancyRate: 100 },
      ]);
    });

    it('buildingId 会传入房间与账单查询条件', async () => {
      await service.overview({ period: 'MONTH', buildingId: 'b-9' } as any);

      expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ buildingId: 'b-9' });
      expect(prisma.bill.findMany.mock.calls[0][0].where.contract).toEqual({ buildingId: 'b-9' });
    });

    it('收款按 paidAt、出账按 dueDate 落在区间内', async () => {
      await service.overview({ period: 'YEAR' } as any);

      const payWhere = prisma.paymentRecord.findMany.mock.calls[0][0].where;
      const billWhere = prisma.bill.findMany.mock.calls[0][0].where;
      expect(payWhere.paidAt.gte).toBeInstanceOf(Date);
      expect(payWhere.paidAt.lte).toBeInstanceOf(Date);
      expect(billWhere.dueDate.gte).toBeInstanceOf(Date);
      expect(billWhere.dueDate.lte).toBeInstanceOf(Date);
    });
  });
});
