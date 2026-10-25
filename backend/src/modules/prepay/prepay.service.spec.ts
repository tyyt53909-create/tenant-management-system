import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from '../bills/payment/payment-provider.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('PrepayService', () => {
  let service: PrepayService;
  let prisma: any;
  let settings: any;

  const accountId = 'account-001';
  const operatorId = 'admin-001';

  beforeEach(async () => {
    const prismaMock: any = {
      prepayAccount: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      prepayTransaction: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      prepayRechargeOrder: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      userIdentity: { findFirst: vi.fn() },
      tenant: { findUnique: vi.fn() },
      room: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrepayService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: SettingsService,
          useValue: { getValue: vi.fn().mockResolvedValue(10000) },
        },
        {
          provide: BusinessClock,
          useValue: {
            formatDate: vi.fn().mockReturnValue('2026-10-26'),
            todayUtc: vi.fn().mockReturnValue(new Date('2026-10-26T00:00:00.000Z')),
          },
        },
        {
          provide: PAYMENT_PROVIDER,
          useValue: {
            name: 'wechat-mock',
            createOrder: vi.fn(),
            queryOrder: vi.fn(),
            refund: vi.fn(),
            createJsapiOrder: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ NODE_ENV: 'test', WECHAT_PAY_MOCK: 'true' }),
        },
        {
          provide: NotificationsService,
          useValue: { create: vi.fn().mockResolvedValue({ id: 'notif-1' }) },
        },
      ],
    }).compile();

    service = module.get<PrepayService>(PrepayService);
    settings = module.get(SettingsService);
    prisma = prismaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordTransaction', () => {
    it('充值：余额增加，流水金额为正', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 10000 });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, balanceCache: 30000 });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-1',
        amount: 20000,
        balanceAfter: 30000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'RECHARGE', amount: 20000, description: '充值 200 元' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { balanceCache: { increment: 20000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'RECHARGE',
          amount: 20000,
          balanceAfter: 30000,
          operatorId,
        }),
      });
      expect(result.transaction.balanceAfter).toBe(30000);
    });

    it('扣费：条件更新（余额充足），流水金额为负', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 30000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({
        id: accountId,
        balanceCache: 10000,
      });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-2',
        amount: -20000,
        balanceAfter: 10000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'DEDUCTION', amount: 20000, description: '电费扣款' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: accountId, balanceCache: { gte: 20000 } },
        data: { balanceCache: { decrement: 20000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: -20000, balanceAfter: 10000 }),
      });
      expect(result.transaction.amount).toBe(-20000);
    });

    it('扣费余额不足：条件更新 count=0 → 400，不写流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 5000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'DEDUCTION', amount: 20000, description: '扣款' } as any,
          operatorId,
        ),
      ).rejects.toThrow('余额不足，无法扣费/退款');
      expect(prisma.prepayTransaction.create).not.toHaveBeenCalled();
    });

    it('退款：同为出账（-amount），余额不足被拒绝', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 5000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'REFUND', amount: 8000, description: '余额退还' } as any,
          operatorId,
        ),
      ).rejects.toThrow('余额不足，无法扣费/退款');
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: accountId, balanceCache: { gte: 8000 } },
        data: { balanceCache: { decrement: 8000 } },
      });
    });

    it('调整（负数）：不做余额校验，直接扣减', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 10000 });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, balanceCache: 4000 });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-3',
        amount: -6000,
        balanceAfter: 4000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'ADJUSTMENT', amount: -6000, description: '修正多收' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { balanceCache: { decrement: 6000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'ADJUSTMENT', amount: -6000 }),
      });
      expect(result.transaction.amount).toBe(-6000);
    });

    it('调整金额为 0：400', async () => {
      await expect(
        service.recordTransaction(
          accountId,
          { type: 'ADJUSTMENT', amount: 0, description: '无效' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    });

    it('充值金额为负：400（方向由类型决定）', async () => {
      await expect(
        service.recordTransaction(
          accountId,
          { type: 'RECHARGE', amount: -100, description: '无效' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    });

    it('账户不存在：404，不写流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'RECHARGE', amount: 10000, description: '充值' } as any,
          operatorId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.prepayTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('findAccountTransactions', () => {
    it('账户不存在：404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.findAccountTransactions(accountId, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('分页倒序返回流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      const records = [{ id: 'tx-2' }, { id: 'tx-1' }];
      prisma.prepayTransaction.findMany.mockResolvedValue(records);
      prisma.prepayTransaction.count.mockResolvedValue(2);

      const result = await service.findAccountTransactions(accountId, { page: 1, limit: 20 });

      expect(result.data).toEqual(records);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith({
        where: { accountId },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('账户管理（T148 核心业务覆盖率补齐）', () => {
    it('create：租客不存在 → 400', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ tenantId: 'tenant-x', roomId: 'room-1' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.create).not.toHaveBeenCalled();
    });

    it('create：同一租客同一房间已有账户 → 409', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });

      await expect(
        service.create({ tenantId: 'tenant-1', roomId: 'room-1' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('create：成功 → 未指定时低余额阈值为 10000 分', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue(null);
      prisma.prepayAccount.create.mockResolvedValue({ id: accountId });

      await service.create({ tenantId: 'tenant-1', roomId: 'room-1' } as any);

      expect(prisma.prepayAccount.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', roomId: 'room-1', lowBalanceThreshold: 10000 },
      });
    });

    it('create：未指定阈值时读取设置中心默认值（T276）', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue(null);
      prisma.prepayAccount.create.mockResolvedValue({ id: accountId });
      settings.getValue.mockResolvedValueOnce(25000);

      await service.create({ tenantId: 'tenant-1', roomId: 'room-1' } as any);

      expect(prisma.prepayAccount.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', roomId: 'room-1', lowBalanceThreshold: 25000 },
      });
    });

    it('create：显式传 0 时保留 0（语义为不提醒，T207 修正 `|| 10000` 把 0 吞掉）', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue(null);
      prisma.prepayAccount.create.mockResolvedValue({ id: accountId });

      await service.create({ tenantId: 'tenant-1', roomId: 'room-1', lowBalanceThreshold: 0 } as any);

      expect(prisma.prepayAccount.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', roomId: 'room-1', lowBalanceThreshold: 0 },
      });
    });

    it('findAll：tenantId 过滤 + 分页 + 补充房间号', async () => {
      prisma.prepayAccount.findMany.mockResolvedValue([
        { id: accountId, roomId: 'room-1' },
        { id: 'account-2', roomId: 'room-2' },
      ]);
      prisma.prepayAccount.count.mockResolvedValue(2);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1', roomNumber: '101' }]);

      const result = await service.findAll({ page: 1, limit: 20, tenantId: 'tenant-1' } as any);

      expect(prisma.prepayAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['room-1', 'room-2'] } },
        select: { id: true, roomNumber: true },
      });
      expect(result.data[0].roomNumber).toBe('101');
      expect(result.data[1].roomNumber).toBeNull();
      expect(result.meta.totalPages).toBe(1);
    });

    it('findOne：存在 → 返回最近 20 条流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, transactions: [] });

      const result = await service.findOne(accountId);

      expect(result.id).toBe(accountId);
      expect(prisma.prepayAccount.findUnique).toHaveBeenCalledWith({
        where: { id: accountId },
        include: { tenant: true, transactions: { take: 20, orderBy: { createdAt: 'desc' } } },
      });
    });

    it('findOne：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.findOne(accountId)).rejects.toThrow(NotFoundException);
    });

    it('update：修改低余额阈值', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, lowBalanceThreshold: 5000 });

      const result = await service.update(accountId, { lowBalanceThreshold: 5000 } as any);

      expect(result.lowBalanceThreshold).toBe(5000);
      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { lowBalanceThreshold: 5000 },
      });
    });

    it('update：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.update(accountId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('remove：无流水且余额为 0 → 删除', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 0 });
      prisma.prepayTransaction.count.mockResolvedValue(0);
      prisma.prepayAccount.delete.mockResolvedValue({ id: accountId });

      await expect(service.remove(accountId)).resolves.toEqual({ message: '预付账户已删除' });
    });

    it('remove：有流水或余额 → 409，不删除', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 100 });
      prisma.prepayTransaction.count.mockResolvedValue(2);

      await expect(service.remove(accountId)).rejects.toThrow(ConflictException);
      expect(prisma.prepayAccount.delete).not.toHaveBeenCalled();
    });

    it('remove：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.remove(accountId)).rejects.toThrow(NotFoundException);
    });

    it('findByTenant：返回账户并补房间号', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue({ id: accountId, roomId: 'room-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1', roomNumber: '101' });

      const result = await service.findByTenant('tenant-1');

      expect(result.room?.roomNumber).toBe('101');
      expect(prisma.prepayAccount.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { tenant: { select: { id: true, name: true } } },
      });
    });

    it('findByTenant：无账户 → 404', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue(null);

      await expect(service.findByTenant('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('findTransactionsByTenant：无账户 → 空结果（不泄漏他人流水）', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue(null);

      const result = await service.findTransactionsByTenant('tenant-1', { page: 1, limit: 20 });

      expect(result.data).toEqual([]);
      expect(prisma.prepayTransaction.findMany).not.toHaveBeenCalled();
    });

    it('findTransactionsByTenant：有账户 → 仅查该账户流水', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue({ id: accountId });
      prisma.prepayTransaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
      prisma.prepayTransaction.count.mockResolvedValue(1);

      const result = await service.findTransactionsByTenant('tenant-1', { page: 1, limit: 20 });

      expect(result.meta.total).toBe(1);
      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountId } }),
      );
    });

    it('findAllTransactions：管理员分页（含租客名）', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
      prisma.prepayTransaction.count.mockResolvedValue(1);

      const result = await service.findAllTransactions({ page: 2, limit: 5 });

      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result.meta).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
    });
  });

  describe('exportTransactions', () => {
    it('正确生成包含 UTF-8 BOM 的预付流水 CSV', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-101',
          type: 'RECHARGE',
          amount: 50000,
          balanceAfter: 68800,
          transactionNumber: 'REC20261014-001',
          description: '微信充值',
          operatorId: 'admin',
          createdAt: new Date('2026-10-14T08:00:00Z'),
          account: {
            roomId: 'room-1',
            tenant: { name: '周八', phone: '13500000008' },
          },
        },
      ]);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1', roomNumber: '601' }]);

      const csv = await service.exportTransactions({});

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('流水号,房间号,租客姓名,租客手机,交易类型,变动金额(元),变动后余额(元),第三方交易号,说明,经办人,时间');
      expect(csv).toContain('tx-101,601,周八,13500000008,充值,500.00,688.00,REC20261014-001,微信充值,admin');
    });
  });

  describe('分支覆盖补充', () => {
    it('findAll：无租客筛选且账户为空时跳过房间查询', async () => {
      prisma.prepayAccount.findMany.mockResolvedValue([]);
      prisma.prepayAccount.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 10 } as any);

      expect(prisma.prepayAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.room.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } });
    });

    it('update：未传低余额阈值时提交空更新数据', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId });

      await service.update(accountId, {} as any);

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: {},
      });
    });

    it('租客交易查询：缺省 query 和缺省 tenantId 均安全返回空结果', async () => {
      await expect(service.findTransactionsByTenant('tenant-1')).resolves.toEqual({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
      await expect(service.findTransactionsByTenant('')).rejects.toThrow(ForbiddenException);
      expect(prisma.prepayAccount.findFirst).toHaveBeenCalledTimes(1);
    });

    it('流水写入：保留 relatedType，且缺失 relatedType 时置为 undefined', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 1000 });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, balanceCache: 2000 });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-related' });

      await service.recordTransaction(
        accountId,
        { type: 'RECHARGE', amount: 1000, relatedId: 'related-1', relatedType: 'BILL' } as any,
        operatorId,
      );
      expect(prisma.prepayTransaction.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ relatedId: 'related-1', relatedType: 'BILL' }),
      });

      await service.recordTransaction(
        accountId,
        { type: 'RECHARGE', amount: 1000, relatedId: 'related-2' } as any,
        operatorId,
      );
      expect(prisma.prepayTransaction.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ relatedId: 'related-2', relatedType: undefined }),
      });
    });

    it('导出：分别应用账户、类型、起止日期过滤', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([]);

      await service.exportTransactions({
        accountId,
        type: 'REFUND',
        startDate: '2026-01-02T00:00:00.000Z',
        endDate: '2026-01-03T00:00:00.000Z',
      } as any);

      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            accountId,
            type: 'REFUND',
            createdAt: {
              gte: new Date('2026-01-02T00:00:00.000Z'),
              lte: new Date('2026-01-03T00:00:00.000Z'),
            },
          },
        }),
      );
      expect(prisma.room.findMany).not.toHaveBeenCalled();
    });

    it('导出：只提供结束日期，并处理缺失关联字段、未知类型及缺失时间', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-sparse',
          type: 'CUSTOM',
          amount: 1,
          balanceAfter: 1,
          relatedId: 'related-fallback',
          account: { roomId: 'room-sparse', tenant: {} },
        },
        {
          id: 'tx-unlinked',
          type: 'ADJUSTMENT',
          amount: 0,
          balanceAfter: 0,
          account: null,
          createdAt: null,
        },
      ]);
      prisma.room.findMany.mockResolvedValue([]);

      const csv = await service.exportTransactions({ endDate: '2026-01-03' });

      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { lte: new Date('2026-01-03') } } }),
      );
      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['room-sparse'] } },
        select: { id: true, roomNumber: true },
      });
      expect(csv).toContain('tx-sparse,,,,CUSTOM');
      expect(csv).toContain('related-fallback');
      expect(csv).toContain('tx-unlinked,,,,调账');
    });

    it('导出：无交易且仅提供开始日期时跳过房间查询', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([]);
      await service.exportTransactions({ startDate: '2026-01-01' });

      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { createdAt: { gte: new Date('2026-01-01') } } }),
      );
      expect(prisma.room.findMany).not.toHaveBeenCalled();
    });
  });

  describe('线上充值与低余额提醒 (PAY-04)', () => {
    it('createJsapiRechargeOrder：租客发起微信充值下单生成待付订单并调起支付', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue({
        id: 'acc-1',
        tenant: { id: 't-1', userId: 'u-1', name: '张三' },
      });
      prisma.userIdentity.findFirst.mockResolvedValue({ providerUserId: 'wx_openid_1' });
      prisma.prepayRechargeOrder.create.mockResolvedValue({ id: 'order-1' });

      const paymentProvider = (service as any).paymentProvider;
      paymentProvider.createJsapiOrder.mockResolvedValue({
        appId: 'wx1',
        timeStamp: '123',
        nonceStr: 'abc',
        package: 'prepay_id=xxx',
        signType: 'RSA',
        paySign: 'sign',
        outTradeNo: 'PREPAY_1',
      });

      const res = await service.createJsapiRechargeOrder(
        { amount: 5000 },
        { userId: 'u-1', role: 'TENANT', tenantId: 't-1' },
      );

      expect(res.orderId).toBe('order-1');
      expect(prisma.prepayRechargeOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'acc-1',
            tenantId: 't-1',
            amount: 5000,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('handleRechargeNotify：微信回调入账，更新余额与流水并生成收据', async () => {
      prisma.prepayRechargeOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        accountId: 'acc-1',
        tenantId: 't-1',
        status: 'PENDING',
        account: { id: 'acc-1', balanceCache: 2000 },
        tenant: { id: 't-1', userId: 'u-1', name: '张三' },
      });
      prisma.prepayAccount.update.mockResolvedValue({ id: 'acc-1', balanceCache: 7000 });
      prisma.prepayRechargeOrder.update.mockResolvedValue({ id: 'order-1', status: 'SUCCESS' });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-1' });

      await service.handleRechargeNotify({
        outTradeNo: 'PREPAY_1',
        transactionId: 'wx_tx_1',
        tradeState: 'SUCCESS',
        amount: 5000,
        openid: 'wx_openid_1',
      });

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-1' },
          data: { balanceCache: { increment: 5000 } },
        }),
      );
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'acc-1',
            type: 'RECHARGE',
            amount: 5000,
            relatedType: 'ONLINE_RECHARGE',
          }),
        }),
      );
      expect((service as any).notificationsService.create).toHaveBeenCalled();
    });

    it('handleRechargeNotify：重复回调幂等跳过，不重复增加入账', async () => {
      prisma.prepayRechargeOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'SUCCESS',
      });

      await service.handleRechargeNotify({
        outTradeNo: 'PREPAY_1',
        transactionId: 'wx_tx_1',
        tradeState: 'SUCCESS',
        amount: 5000,
        openid: 'wx_openid_1',
      });

      expect(prisma.prepayAccount.update).not.toHaveBeenCalled();
    });

    it('triggerLowBalanceAlertIfNeeded：余额低于阈值且今日未提醒时触发通知并更新时间', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        balanceCache: 3000,
        lowBalanceThreshold: 10000,
        lastNotifiedAt: null,
        tenant: { id: 't-1', userId: 'u-1', name: '张三' },
      });
      prisma.prepayAccount.update.mockResolvedValue({ id: 'acc-1' });

      const triggered = await service.triggerLowBalanceAlertIfNeeded('acc-1');

      expect(triggered).toBe(true);
      expect((service as any).notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          data: expect.objectContaining({ type: 'PREPAY_LOW_BALANCE', balance: 3000 }),
        }),
      );
      expect(prisma.prepayAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-1' },
          data: { lastNotifiedAt: expect.any(Date) },
        }),
      );
    });

    it('triggerLowBalanceAlertIfNeeded：今日已提醒过则防骚扰跳过', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({
        id: 'acc-1',
        balanceCache: 3000,
        lowBalanceThreshold: 10000,
        lastNotifiedAt: new Date('2026-10-26T08:00:00.000Z'),
        tenant: { id: 't-1', userId: 'u-1', name: '张三' },
      });

      const triggered = await service.triggerLowBalanceAlertIfNeeded('acc-1');
      expect(triggered).toBe(false);
      expect(prisma.prepayAccount.update).not.toHaveBeenCalled();
    });

    it('createJsapiRechargeOrder：金额非法、账户不存在、管理者下单等全分支覆盖', async () => {
      // 1. 金额 <= 0
      await expect(
        service.createJsapiRechargeOrder(
          { amount: 0 },
          { userId: 'u1', role: 'TENANT', tenantId: 't1' },
        ),
      ).rejects.toThrow(BadRequestException);

      // 2. 租客未找到账户
      prisma.prepayAccount.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.createJsapiRechargeOrder(
          { amount: 100 },
          { userId: 'u1', role: 'TENANT', tenantId: 't1' },
        ),
      ).rejects.toThrow(NotFoundException);

      // 3. 管理者未指定 targetAccountId
      await expect(
        service.createJsapiRechargeOrder({ amount: 100 }, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);

      // 4. 管理者指定了不存在的账户
      prisma.prepayAccount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createJsapiRechargeOrder(
          { amount: 100 },
          { userId: 'admin', role: 'ADMIN' },
          'acc-not-exist',
        ),
      ).rejects.toThrow(NotFoundException);

      // 5. 生产环境缺少 openid
      const configService = (service as any).configService;
      configService.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'WECHAT_PAY_MOCK') return 'false';
        return undefined;
      });
      prisma.prepayAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-prod',
        tenant: { id: 't-prod', userId: 'u-prod', name: '李四' },
      });
      prisma.userIdentity.findFirst.mockResolvedValueOnce(null);
      const paymentProvider = (service as any).paymentProvider;
      paymentProvider.name = 'wechat-real';

      await expect(
        service.createJsapiRechargeOrder(
          { amount: 100 },
          { userId: 'admin', role: 'ADMIN' },
          'acc-prod',
        ),
      ).rejects.toThrow('未检测到绑定的微信身份');

      // 6. 通道不支持 JSAPI
      paymentProvider.name = 'wechat-mock';
      configService.get = vi.fn().mockReturnValue('test');
      prisma.prepayAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-real',
        tenant: { id: 't-real', userId: 'u-real', name: '王五' },
      });
      const originalCreateJsapi = paymentProvider.createJsapiOrder;
      paymentProvider.createJsapiOrder = undefined;

      await expect(
        service.createJsapiRechargeOrder(
          { amount: 100 },
          { userId: 'admin', role: 'ADMIN' },
          'acc-real',
        ),
      ).rejects.toThrow('当前支付通道不支持微信 JSAPI 线上支付');

      paymentProvider.createJsapiOrder = originalCreateJsapi;
    });

    it('handleRechargeNotify：订单不存在、租客无账号等分支', async () => {
      // 1. 订单不存在
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce(null);
      await service.handleRechargeNotify({
        outTradeNo: 'NOT_FOUND',
        transactionId: 'tx',
        tradeState: 'SUCCESS',
        amount: 100,
        openid: 'openid',
      });
      expect(prisma.prepayAccount.update).not.toHaveBeenCalled();

      // 2. 租客无 userId
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'order-nouser',
        accountId: 'acc-1',
        tenantId: 't-1',
        status: 'PENDING',
        account: { id: 'acc-1', balanceCache: 100 },
        tenant: { id: 't-1', userId: null },
      });
      prisma.prepayRechargeOrder.update.mockResolvedValueOnce({ id: 'order-nouser' });
      prisma.prepayAccount.update.mockResolvedValueOnce({ id: 'acc-1', balanceCache: 200 });
      prisma.prepayTransaction.create.mockResolvedValueOnce({ id: 'tx-nouser' });

      await service.handleRechargeNotify({
        outTradeNo: 'PREPAY_NOUSER',
        transactionId: 'tx',
        tradeState: 'SUCCESS',
        amount: 100,
        openid: 'openid',
      });
      expect((service as any).notificationsService.create).not.toHaveBeenCalled();
    });

    it('queryAndSyncRechargeOrder：全分支覆盖', async () => {
      // 1. 订单不存在
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.queryAndSyncRechargeOrder(
          { outTradeNo: 'NOT_EXIST' },
          { userId: 'u1', role: 'ADMIN' },
        ),
      ).rejects.toThrow(NotFoundException);

      // 2. 租客查询他人订单
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-other',
        tenantId: 't-other',
        outTradeNo: 'PREPAY_OTHER',
      });
      await expect(
        service.queryAndSyncRechargeOrder(
          { outTradeNo: 'PREPAY_OTHER' },
          { userId: 'u1', role: 'TENANT', tenantId: 't-self' },
        ),
      ).rejects.toThrow(ForbiddenException);

      // 3. 订单已经是 SUCCESS
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-succ',
        outTradeNo: 'PREPAY_SUCC',
        status: 'SUCCESS',
        amount: 5000,
        paidAt: new Date(),
        receiptNumber: 'R001',
      });
      const succRes = await service.queryAndSyncRechargeOrder(
        { outTradeNo: 'PREPAY_SUCC' },
        { userId: 'u1', role: 'ADMIN' },
      );
      expect(succRes.status).toBe('SUCCESS');

      // 4. 支付通道不支持 queryOrder
      const paymentProvider = (service as any).paymentProvider;
      const originalQueryOrder = paymentProvider.queryOrder;
      paymentProvider.queryOrder = undefined;
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-noquery',
        outTradeNo: 'PREPAY_NOQUERY',
        status: 'PENDING',
      });
      await expect(
        service.queryAndSyncRechargeOrder(
          { outTradeNo: 'PREPAY_NOQUERY' },
          { userId: 'u1', role: 'ADMIN' },
        ),
      ).rejects.toThrow('当前支付通道不支持微信查单');
      paymentProvider.queryOrder = originalQueryOrder;

      // 5. 远端查无此单
      paymentProvider.queryOrder.mockResolvedValueOnce(null);
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-null',
        outTradeNo: 'PREPAY_NULL',
        status: 'PENDING',
        amount: 2000,
      });
      const nullRes = await service.queryAndSyncRechargeOrder(
        { outTradeNo: 'PREPAY_NULL' },
        { userId: 'u1', role: 'ADMIN' },
      );
      expect(nullRes.status).toBe('PENDING');

      // 6. 远端返回非 SUCCESS（例如 NOTPAY）
      paymentProvider.queryOrder.mockResolvedValueOnce({
        orderId: 'PREPAY_NOTPAY',
        status: 'NOTPAY',
        tradeState: 'NOTPAY',
        amount: 2000,
      });
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-notpay',
        outTradeNo: 'PREPAY_NOTPAY',
        status: 'PENDING',
        amount: 2000,
      });
      const notpayRes = await service.queryAndSyncRechargeOrder(
        { outTradeNo: 'PREPAY_NOTPAY' },
        { userId: 'u1', role: 'ADMIN' },
      );
      expect(notpayRes.status).toBe('NOTPAY');

      // 7. 远端返回 SUCCESS 并补全入账
      paymentProvider.queryOrder.mockResolvedValueOnce({
        orderId: 'PREPAY_SYNC',
        status: 'SUCCESS',
        tradeState: 'SUCCESS',
        amount: 3000,
        transactionId: 'tx_sync',
      });
      prisma.prepayRechargeOrder.findUnique.mockResolvedValueOnce({
        id: 'o-sync',
        accountId: 'acc-1',
        tenantId: 't-1',
        outTradeNo: 'PREPAY_SYNC',
        status: 'PENDING',
        amount: 3000,
        account: { id: 'acc-1', balanceCache: 1000 },
        tenant: { id: 't-1', userId: 'u-1', name: '测试' },
      });
      prisma.prepayRechargeOrder.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'o-sync',
        outTradeNo: 'PREPAY_SYNC',
        status: 'SUCCESS',
        amount: 3000,
        receiptNumber: 'R002',
      });
      const syncRes = await service.queryAndSyncRechargeOrder(
        { outTradeNo: 'PREPAY_SYNC' },
        { userId: 'u1', role: 'ADMIN' },
      );
      expect(syncRes.status).toBe('SUCCESS');
    });

    it('triggerLowBalanceAlertIfNeeded：账户缺失或余额高于阈值', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValueOnce(null);
      expect(await service.triggerLowBalanceAlertIfNeeded('none')).toBe(false);

      prisma.prepayAccount.findUnique.mockResolvedValueOnce({
        id: 'acc-high',
        balanceCache: 20000,
        lowBalanceThreshold: 10000,
        tenant: { userId: 'u1' },
      });
      expect(await service.triggerLowBalanceAlertIfNeeded('acc-high')).toBe(false);
    });
  });
});
