import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService, SYSTEM_OPERATOR } from './scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('SchedulerService（定时任务）', () => {
  let service: SchedulerService;
  let prisma: any;
  let billsService: any;
  let notifications: any;

  // 固定时间：2026-10-13（UTC），便于日期断言
  const FIXED_NOW = new Date('2026-10-13T04:00:00.000Z');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    prisma = {
      contract: { findMany: vi.fn(), update: vi.fn() },
      room: { findUnique: vi.fn(), update: vi.fn() },
      bill: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      maintenanceRequest: { updateMany: vi.fn() },
      prepayAccount: {
        findMany: vi.fn(),
        update: vi.fn(),
        fields: { lowBalanceThreshold: { __field: true } },
      },
      notification: { findFirst: vi.fn() },
    };
    billsService = { addLateFee: vi.fn(), create: vi.fn() };
    notifications = { create: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: BillsService, useValue: billsService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('autoTransitionContracts', () => {
    it('DRAFT 生效日到达 → ACTIVE，预留房间随动 OCCUPIED（版本递增）', async () => {
      prisma.contract.findMany
        .mockResolvedValueOnce([{ id: 'c-1', roomId: 'r-1' }]) // DRAFT
        .mockResolvedValueOnce([]); // EXPIRED
      prisma.room.findUnique.mockResolvedValue({ id: 'r-1', status: 'RESERVED' });

      const result = await service.autoTransitionContracts();

      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { status: 'ACTIVE' },
      });
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r-1' },
        data: { status: 'OCCUPIED', version: { increment: 1 } },
      });
      expect(result).toEqual({ activated: 1, expired: 0 });
    });

    it('房间非 RESERVED 时不随动（保护人工房态）', async () => {
      prisma.contract.findMany
        .mockResolvedValueOnce([{ id: 'c-1', roomId: 'r-1' }])
        .mockResolvedValueOnce([]);
      prisma.room.findUnique.mockResolvedValue({ id: 'r-1', status: 'VACANT' });

      await service.autoTransitionContracts();

      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('ACTIVE 到期 → EXPIRED + 到期提醒（仅对有账号租客发送）', async () => {
      prisma.contract.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'c-2', endDate: new Date('2026-10-01T00:00:00.000Z'), tenant: { userId: 'u-1' } },
          { id: 'c-3', endDate: new Date('2026-10-02T00:00:00.000Z'), tenant: { userId: null } },
        ]);

      const result = await service.autoTransitionContracts();

      expect(prisma.contract.update).toHaveBeenCalledTimes(2);
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', title: '合同已到期' }),
      );
      expect(result.expired).toBe(2);
    });
  });

  describe('checkOverdueBills', () => {
    it('到期未缴 → OVERDUE + 滞纳金建议 + 逾期提醒', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-1',
          amount: 100000,
          paidAmount: 0,
          dueDate: new Date('2026-10-11T00:00:00.000Z'), // 逾期 2 天
          contract: { tenant: { userId: 'u-1' } },
        },
      ]);
      billsService.addLateFee.mockResolvedValue({ id: 'lf-1' });

      const result = await service.checkOverdueBills();

      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: 'b-1' },
        data: { status: 'OVERDUE' },
      });
      expect(billsService.addLateFee).toHaveBeenCalledWith('b-1', {}, SYSTEM_OPERATOR);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', title: '账单逾期提醒', priority: 'URGENT' }),
      );
      expect(result).toEqual({ overdue: 1, suggested: 1 });
    });

    it('滞纳金已确认（409）→ 跳过建议不中断，逾期流转与提醒照常', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-1',
          amount: 100000,
          paidAmount: 0,
          dueDate: new Date('2026-10-01T00:00:00.000Z'),
          contract: { tenant: { userId: 'u-1' } },
        },
      ]);
      billsService.addLateFee.mockRejectedValue(new ConflictException('已确认'));

      const result = await service.checkOverdueBills();

      expect(result.overdue).toBe(1);
      expect(result.suggested).toBe(0);
      expect(notifications.create).toHaveBeenCalled();
    });

    it('本金已缴清（仅滞纳金未结）→ 不重复产生建议', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-1',
          amount: 100000,
          paidAmount: 100000,
          dueDate: new Date('2026-10-01T00:00:00.000Z'),
          contract: { tenant: { userId: null } },
        },
      ]);

      await service.checkOverdueBills();

      expect(billsService.addLateFee).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('sendBillReminders', () => {
    const bill = (over: Record<string, unknown> = {}) => ({
      id: 'b-1',
      dueDate: new Date('2026-10-16T00:00:00.000Z'), // 距 10-13 还有 3 天
      contract: { tenant: { userId: 'u-1' } },
      ...over,
    });

    it('到期前 3 天 → 即将到期提醒', async () => {
      prisma.bill.findMany.mockResolvedValue([bill()]);
      prisma.notification.findFirst.mockResolvedValue(null);

      const sent = await service.sendBillReminders();

      expect(sent).toBe(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', title: '账单即将到期提醒' }),
      );
    });

    it('当日到期 → 到期提醒', async () => {
      prisma.bill.findMany.mockResolvedValue([
        bill({ dueDate: new Date('2026-10-13T00:00:00.000Z') }),
      ]);
      prisma.notification.findFirst.mockResolvedValue(null);

      await service.sendBillReminders();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: '账单到期提醒' }),
      );
    });

    it('逾期 3 天提醒；逾期 2 天不提醒（节点：1/3/7）', async () => {
      prisma.bill.findMany.mockResolvedValue([
        bill({ id: 'b-3', dueDate: new Date('2026-10-10T00:00:00.000Z') }),
        bill({ id: 'b-2', dueDate: new Date('2026-10-11T00:00:00.000Z') }),
      ]);
      prisma.notification.findFirst.mockResolvedValue(null);

      const sent = await service.sendBillReminders();

      expect(sent).toBe(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: '账单逾期提醒', body: expect.stringContaining('3 天') }),
      );
    });

    it('同日已发过同标题 → 去重跳过', async () => {
      prisma.bill.findMany.mockResolvedValue([bill()]);
      prisma.notification.findFirst.mockResolvedValue({ id: 'n-1' });

      const sent = await service.sendBillReminders();

      expect(sent).toBe(0);
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('报修自动确认与升级', () => {
    it('PENDING_CONFIRM 超 3 天 → 自动确认 COMPLETED（含结论文案）', async () => {
      prisma.maintenanceRequest.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.autoConfirmMaintenance();

      expect(count).toBe(2);
      const call = prisma.maintenanceRequest.updateMany.mock.calls[0][0];
      expect(call.where.status).toBe('PENDING_CONFIRM');
      expect(call.where.updatedAt.lt).toBeInstanceOf(Date);
      expect(call.data).toEqual(
        expect.objectContaining({
          status: 'COMPLETED',
          resolvedAt: expect.any(Date),
          resolution: expect.stringContaining('自动确认'),
        }),
      );
    });

    it('SUBMITTED 普通工单超 3 天 → 升级 URGENT', async () => {
      prisma.maintenanceRequest.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.upgradeMaintenancePriority();

      expect(count).toBe(1);
      expect(prisma.maintenanceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SUBMITTED', priority: 'NORMAL' }),
          data: { priority: 'URGENT' },
        }),
      );
    });
  });

  describe('notifyLowBalancePrepay', () => {
    it('低于阈值且今日未提醒 → 通知 + 写 lastNotifiedAt', async () => {
      prisma.prepayAccount.findMany.mockResolvedValue([
        { id: 'pa-1', balanceCache: 5000, lowBalanceThreshold: 10000, tenant: { userId: 'u-1' } },
      ]);

      const sent = await service.notifyLowBalancePrepay();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', title: '预付余额不足提醒' }),
      );
      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
        data: { lastNotifiedAt: expect.any(Date) },
      });
      expect(sent).toBe(1);
    });

    it('租客无账号 → 不通知、不写 lastNotifiedAt', async () => {
      prisma.prepayAccount.findMany.mockResolvedValue([
        { id: 'pa-1', balanceCache: 0, lowBalanceThreshold: 10000, tenant: { userId: null } },
      ]);

      const sent = await service.notifyLowBalancePrepay();

      expect(sent).toBe(0);
      expect(notifications.create).not.toHaveBeenCalled();
      expect(prisma.prepayAccount.update).not.toHaveBeenCalled();
    });
  });

  describe('generateMonthlyBills', () => {
    const contract = {
      id: 'c-1',
      contractNumber: 'CN-001',
      rentAmount: 180000,
      paymentCycle: 'MONTHLY',
      paymentDay: 5,
      tenant: { userId: 'u-1' },
    };

    it('生成租金账单（快照 + RENT + 收租提醒）', async () => {
      prisma.contract.findMany.mockResolvedValue([contract]);
      prisma.bill.findFirst.mockResolvedValue(null);
      billsService.create.mockResolvedValue({ id: 'b-new' });

      const result = await service.generateMonthlyBills();

      expect(billsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'c-1',
          billType: 'RENT',
          period: '2026-10',
          amount: 180000,
          snapshot: expect.objectContaining({ rentAmount: 180000 }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', title: '收租提醒' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ period: '2026-10', generated: 1, skipped: 0, notified: 1 }),
      );
    });

    it('同账期已有账单 → 跳过（幂等）', async () => {
      prisma.contract.findMany.mockResolvedValue([contract]);
      prisma.bill.findFirst.mockResolvedValue({ id: 'b-existing' });

      const result = await service.generateMonthlyBills();

      expect(billsService.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('仅 ACTIVE + MONTHLY 且未到期的合同进入生成范围', async () => {
      prisma.contract.findMany.mockResolvedValue([]);

      await service.generateMonthlyBills();

      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('ACTIVE');
      expect(where.paymentCycle).toBe('MONTHLY');
      expect(where.endDate.gte).toBeInstanceOf(Date);
    });

    it('上海时间每月 1 日 01:10 触发时（UTC 为前一月最后一天 17:10），正确按上海时区生成本月账期（2026-11）', async () => {
      // UTC 2026-10-31 17:10:00 对应 Asia/Shanghai 2026-11-01 01:10:00
      const shanghaiNov1stTrigger = new Date('2026-10-31T17:10:00.000Z');
      prisma.contract.findMany.mockResolvedValue([contract]);
      prisma.bill.findFirst.mockResolvedValue(null);
      billsService.create.mockResolvedValue({ id: 'b-nov' });

      const result = await service.generateMonthlyBills(shanghaiNov1stTrigger);

      expect(result.period).toBe('2026-11');
      expect(billsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          period: '2026-11',
          dueDate: '2026-11-05T00:00:00.000Z',
        }),
      );
    });
  });

  describe('runDaily（聚合）', () => {
    it('单项失败不阻断其他任务，并记入 errors', async () => {
      prisma.contract.findMany.mockRejectedValue(new Error('db down'));
      prisma.bill.findMany.mockResolvedValue([]);
      prisma.notification.findFirst.mockResolvedValue(null);
      prisma.maintenanceRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.prepayAccount.findMany.mockResolvedValue([]);

      const summary = await service.runDaily();

      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0]).toContain('合同自动流转失败');
      expect(summary.billsOverdue).toBe(0);
      expect(summary.remindersSent).toBe(0);
    });
  });

  describe('cleanupExpiredNotifications', () => {
    it('删除超过 180 天的通知', async () => {
      prisma.notification.deleteMany = vi.fn().mockResolvedValue({ count: 3 });

      await expect(service.cleanupExpiredNotifications()).resolves.toBe(3);
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date(FIXED_NOW.getTime() - 180 * 86_400_000) } },
      });
    });
  });

  describe('rerun', () => {
    it('未知任务名拒绝重跑', () => {
      expect(() => service.rerun('nope', 'MANUAL')).toThrow(NotFoundException);
    });
  });
});
