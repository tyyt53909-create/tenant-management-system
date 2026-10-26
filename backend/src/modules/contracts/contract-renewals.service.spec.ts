import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ContractRenewalsService } from './contract-renewals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ContractsService } from './contracts.service.js';

describe('ContractRenewalsService', () => {
  let service: ContractRenewalsService;
  let prisma: any;
  let notifications: any;
  let contractsService: any;

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      renewalIntent: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      renewalOffer: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    };

    notifications = {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    contractsService = {
      renew: vi.fn().mockResolvedValue({ id: 'renewed-contract-1', contractNumber: 'CN-RENEW-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractRenewalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: ContractsService, useValue: contractsService },
      ],
    }).compile();

    service = module.get<ContractRenewalsService>(ContractRenewalsService);
  });

  describe('submitRenewalIntent', () => {
    it('合同不存在或租客不匹配时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(
        service.submitRenewalIntent('c-1', 'tenant-1', { intent: 'RENEW' as any }),
      ).rejects.toThrow(BadRequestException);

      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'other-tenant', status: 'ACTIVE' });
      await expect(
        service.submitRenewalIntent('c-1', 'tenant-1', { intent: 'RENEW' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('合同非 ACTIVE/EXPIRED 时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', status: 'TERMINATED' });
      await expect(
        service.submitRenewalIntent('c-1', 'tenant-1', { intent: 'RENEW' as any }),
      ).rejects.toThrow(/只有生效中或刚到期的合同可提交续约意向/);
    });

    it('首次提交意向正常创建', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', status: 'ACTIVE' });
      prisma.renewalIntent.findFirst.mockResolvedValue(null);
      prisma.renewalIntent.create.mockResolvedValue({ id: 'ri-1', intent: 'RENEW', contractId: 'c-1' });

      const res = await service.submitRenewalIntent('c-1', 'tenant-1', {
        intent: 'RENEW' as any,
        expectedMonths: 12,
        expectedRent: 350000,
        notes: '希望保持原价',
      });

      expect(res.id).toBe('ri-1');
      expect(prisma.renewalIntent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contractId: 'c-1',
          tenantId: 'tenant-1',
          intent: 'RENEW',
          expectedMonths: 12,
          expectedRent: 350000,
          notes: '希望保持原价',
        }),
      });
    });

    it('重复提交时更新已有意向', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1', status: 'ACTIVE' });
      prisma.renewalIntent.findFirst.mockResolvedValue({ id: 'ri-existing', contractId: 'c-1' });
      prisma.renewalIntent.update.mockResolvedValue({ id: 'ri-existing', intent: 'NOT_RENEW' });

      const res = await service.submitRenewalIntent('c-1', 'tenant-1', {
        intent: 'NOT_RENEW' as any,
        notes: '工作变动退租',
      });

      expect(res.id).toBe('ri-existing');
      expect(prisma.renewalIntent.update).toHaveBeenCalledWith({
        where: { id: 'ri-existing' },
        data: expect.objectContaining({
          intent: 'NOT_RENEW',
          notes: '工作变动退租',
        }),
      });
    });
  });

  describe('getRenewalIntent', () => {
    it('租客查询非本人合同抛 NotFoundException', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'other' });
      await expect(service.getRenewalIntent('c-1', 'tenant-1', true)).rejects.toThrow(NotFoundException);
    });

    it('管理员或合法租客查询返回意向记录', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-1' });
      prisma.renewalIntent.findFirst.mockResolvedValue({ id: 'ri-1', intent: 'CONSIDERING' });

      const res = await service.getRenewalIntent('c-1', 'tenant-1', true);
      expect(res?.intent).toBe('CONSIDERING');
    });
  });

  describe('findAllRenewalIntents', () => {
    it('支持分页与条件筛选', async () => {
      prisma.renewalIntent.findMany.mockResolvedValue([{ id: 'ri-1' }]);
      prisma.renewalIntent.count.mockResolvedValue(1);

      const res = await service.findAllRenewalIntents({ page: 1, limit: 10, intent: 'RENEW' as any });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
      expect(prisma.renewalIntent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { intent: 'RENEW' },
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('createRenewalOffer', () => {
    it('合同不存在抛 NotFoundException', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(
        service.createRenewalOffer('c-1', 'admin-1', {
          offeredRent: 300000,
          offeredDeposit: 300000,
          startDate: '2026-11-01',
          endDate: '2027-10-31',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('到期日不晚于起始日抛 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', roomId: 'r-1', tenantId: 't-1' });
      await expect(
        service.createRenewalOffer('c-1', 'admin-1', {
          offeredRent: 300000,
          offeredDeposit: 300000,
          startDate: '2026-11-01',
          endDate: '2026-10-31',
        }),
      ).rejects.toThrow(/续约到期日必须晚于续约起始日/);
    });

    it('正常创建报价单并触发通知', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c-1',
        roomId: 'r-1',
        tenantId: 't-1',
        tenant: { userId: 'u-1', name: '张三' },
      });
      prisma.renewalOffer.create.mockResolvedValue({
        id: 'ro-1',
        offerNumber: 'RO123456',
        offeredRent: 320000,
        status: 'PENDING',
      });

      const res = await service.createRenewalOffer('c-1', 'admin-1', {
        offeredRent: 320000,
        offeredDeposit: 320000,
        startDate: '2026-11-01',
        endDate: '2027-10-31',
        discountNotes: '续租老客户9折特惠',
      });

      expect(res.id).toBe('ro-1');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-1',
          title: '收到专属续约报价方案',
          body: expect.stringContaining('3200.00'),
        }),
      );
    });

    it('通知发送异常时不影响报价单生成', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c-1',
        roomId: 'r-1',
        tenantId: 't-1',
        tenant: { userId: 'u-1' },
      });
      prisma.renewalOffer.create.mockResolvedValue({ id: 'ro-1', status: 'PENDING' });
      notifications.create.mockRejectedValue(new Error('network error'));

      const res = await service.createRenewalOffer('c-1', 'admin-1', {
        offeredRent: 300000,
        offeredDeposit: 300000,
        startDate: '2026-11-01',
        endDate: '2027-10-31',
      });
      expect(res.id).toBe('ro-1');
    });
  });

  describe('findAllRenewalOffers & findMyRenewalOffers', () => {
    it('findAllRenewalOffers 支持条件查询与分页', async () => {
      prisma.renewalOffer.findMany.mockResolvedValue([{ id: 'ro-1' }]);
      prisma.renewalOffer.count.mockResolvedValue(1);

      const res = await service.findAllRenewalOffers({
        page: 1,
        limit: 10,
        status: 'PENDING' as any,
        contractId: 'c-1',
        tenantId: 't-1',
        roomId: 'r-1',
      });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
      expect(prisma.renewalOffer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PENDING',
            contractId: 'c-1',
            tenantId: 't-1',
            roomId: 'r-1',
          }),
        }),
      );
    });

    it('findMyRenewalOffers 使用 scopedWhere 限制租客数据范围', async () => {
      prisma.renewalOffer.findMany.mockResolvedValue([{ id: 'ro-1' }]);
      prisma.renewalOffer.count.mockResolvedValue(1);

      const res = await service.findMyRenewalOffers('t-1', {
        page: 1,
        limit: 10,
        status: 'PENDING' as any,
        contractId: 'c-1',
      });
      expect(res.data).toHaveLength(1);
      expect(prisma.renewalOffer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't-1',
            status: 'PENDING',
            contractId: 'c-1',
          }),
        }),
      );
    });
  });

  describe('findOneRenewalOffer & findOneRenewalOfferForTenant', () => {
    it('findOneRenewalOffer 不存在抛 NotFoundException', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue(null);
      await expect(service.findOneRenewalOffer('ro-none')).rejects.toThrow(NotFoundException);
    });

    it('findOneRenewalOffer 成功返回', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1' });
      const res = await service.findOneRenewalOffer('ro-1');
      expect(res.id).toBe('ro-1');
    });

    it('findOneRenewalOfferForTenant 验证租客归属', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue(null);
      await expect(service.findOneRenewalOfferForTenant('ro-1', 't-1')).rejects.toThrow(NotFoundException);

      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1', tenantId: 'other-tenant' });
      await expect(service.findOneRenewalOfferForTenant('ro-1', 't-1')).rejects.toThrow(NotFoundException);

      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1', tenantId: 't-1' });
      const res = await service.findOneRenewalOfferForTenant('ro-1', 't-1');
      expect(res.id).toBe('ro-1');
    });
  });

  describe('respondRenewalOffer', () => {
    it('报价单不存在或不属于租客抛 NotFoundException', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue(null);
      await expect(service.respondRenewalOffer('ro-1', 't-1', { agree: true })).rejects.toThrow(
        NotFoundException,
      );

      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1', tenantId: 'other' });
      await expect(service.respondRenewalOffer('ro-1', 't-1', { agree: true })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('报价非 PENDING 抛 ConflictException', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({
        id: 'ro-1',
        tenantId: 't-1',
        status: 'ACCEPTED',
      });
      await expect(service.respondRenewalOffer('ro-1', 't-1', { agree: true })).rejects.toThrow(
        ConflictException,
      );
    });

    it('报价已过 validUntil 抛 BadRequestException 并标记 EXPIRED', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({
        id: 'ro-1',
        tenantId: 't-1',
        status: 'PENDING',
        validUntil: new Date('2026-01-01'),
      });
      prisma.renewalOffer.update.mockResolvedValue({ id: 'ro-1', status: 'EXPIRED' });

      await expect(service.respondRenewalOffer('ro-1', 't-1', { agree: true })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.renewalOffer.update).toHaveBeenCalledWith({
        where: { id: 'ro-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('租客接受报价自动联动 contractsService.renew 并更新为 ACCEPTED', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({
        id: 'ro-1',
        tenantId: 't-1',
        contractId: 'c-orig',
        offeredRent: 350000,
        offeredDeposit: 350000,
        startDate: new Date('2026-11-01T00:00:00Z'),
        endDate: new Date('2027-10-31T00:00:00Z'),
        status: 'PENDING',
      });
      prisma.renewalOffer.update.mockResolvedValue({
        id: 'ro-1',
        status: 'ACCEPTED',
        renewedContractId: 'renewed-contract-1',
      });

      const res = await service.respondRenewalOffer('ro-1', 't-1', { agree: true });

      expect(contractsService.renew).toHaveBeenCalledWith('c-orig', {
        rentAmount: 350000,
        depositAmount: 350000,
        startDate: '2026-11-01',
        endDate: '2027-10-31',
      });
      expect(res.status).toBe('ACCEPTED');
      expect((res as any).renewedContract.id).toBe('renewed-contract-1');
    });

    it('租客拒绝报价更新为 REJECTED', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({
        id: 'ro-1',
        tenantId: 't-1',
        contractId: 'c-orig',
        status: 'PENDING',
      });
      prisma.renewalOffer.update.mockResolvedValue({
        id: 'ro-1',
        status: 'REJECTED',
        rejectReason: '租金偏高',
      });

      const res = await service.respondRenewalOffer('ro-1', 't-1', {
        agree: false,
        rejectReason: '租金偏高',
      });

      expect(contractsService.renew).not.toHaveBeenCalled();
      expect(res.status).toBe('REJECTED');
    });
  });

  describe('cancelRenewalOffer', () => {
    it('非 PENDING 报价撤回抛 ConflictException', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1', status: 'ACCEPTED' });
      await expect(service.cancelRenewalOffer('ro-1')).rejects.toThrow(ConflictException);
    });

    it('PENDING 报价正常撤回更新为 CANCELLED', async () => {
      prisma.renewalOffer.findUnique.mockResolvedValue({ id: 'ro-1', status: 'PENDING' });
      prisma.renewalOffer.update.mockResolvedValue({ id: 'ro-1', status: 'CANCELLED' });

      const res = await service.cancelRenewalOffer('ro-1');
      expect(res.status).toBe('CANCELLED');
    });
  });

  describe('findExpiringContracts', () => {
    it('返回未来到期合同并计算 remainingDays 与附带最新意向及报价', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 15 * 86_400_000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-1',
          endDate: futureDate,
          renewalIntents: [{ id: 'ri-1', intent: 'RENEW' }],
          renewalOffers: [{ id: 'ro-1', status: 'PENDING' }],
        },
      ]);

      const res = await service.findExpiringContracts(30);
      expect(res).toHaveLength(1);
      expect(res[0].remainingDays).toBeGreaterThanOrEqual(14);
      expect(res[0].latestIntent.id).toBe('ri-1');
      expect(res[0].latestOffer.id).toBe('ro-1');
    });
  });

  describe('findHoldoverContracts', () => {
    it('仅识别既未生效续租也未退租完成的滞留合同', async () => {
      const pastDate = new Date(Date.now() - 5 * 86_400_000);

      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'c-holdover',
          endDate: pastDate,
          room: { id: 'r-1', status: 'OCCUPIED' },
          checkoutRecords: [],
          renewedTo: null,
        },
        {
          id: 'c-renewed',
          endDate: pastDate,
          room: { id: 'r-2', status: 'OCCUPIED' },
          checkoutRecords: [],
          renewedTo: { id: 'c-next', status: 'ACTIVE' }, // 已生效续约，排除
        },
        {
          id: 'c-checkedout',
          endDate: pastDate,
          room: { id: 'r-3', status: 'OCCUPIED' },
          checkoutRecords: [{ status: 'COMPLETED' }], // 已完成退租，排除
          renewedTo: null,
        },
      ]);

      const res = await service.findHoldoverContracts();
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('c-holdover');
      expect(res[0].daysOverdue).toBeGreaterThanOrEqual(4);
    });
  });
});
