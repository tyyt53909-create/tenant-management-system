import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutRequestsService } from './checkout-requests.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('CheckoutRequestsService', () => {
  let service: CheckoutRequestsService;
  let prisma: any;
  let settings: any;
  let notifications: any;

  beforeEach(async () => {
    const prismaMock: any = {
      contract: { findUnique: vi.fn() },
      checkoutRequest: {
        findFirst: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      checkoutRecord: {
        create: vi.fn(),
      },
    };
    prismaMock.$transaction = vi.fn(async (cb: any) => cb(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutRequestsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: SettingsService,
          useValue: {
            getValue: vi.fn().mockImplementation(async (key: string) => {
              if (key === 'leasing.minCheckoutAdvanceDays') return 7;
              return 0;
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn().mockResolvedValue({ id: 'n1' }),
          },
        },
      ],
    }).compile();

    service = module.get<CheckoutRequestsService>(CheckoutRequestsService);
    prisma = prismaMock;
    settings = module.get<SettingsService>(SettingsService);
    notifications = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('合同不属于该租客时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        tenantId: 'other-tenant',
        status: 'ACTIVE',
      });

      await expect(
        service.create(
          {
            contractId: 'c1',
            expectedCheckoutDate: '2026-12-01',
          },
          'my-tenant',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('合同非 ACTIVE 状态时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        tenantId: 'my-tenant',
        status: 'DRAFT',
      });

      await expect(
        service.create(
          {
            contractId: 'c1',
            expectedCheckoutDate: '2026-12-01',
          },
          'my-tenant',
        ),
      ).rejects.toThrow('只有生效中的合同可以发起退租申请');
    });

    it('已有待审核申请时抛出 ConflictException', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        tenantId: 'my-tenant',
        status: 'ACTIVE',
      });
      prisma.checkoutRequest.findFirst.mockResolvedValue({ id: 'cr-existing', status: 'PENDING' });

      await expect(
        service.create(
          {
            contractId: 'c1',
            expectedCheckoutDate: '2026-12-01',
          },
          'my-tenant',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('不满足提前天数要求时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        tenantId: 'my-tenant',
        status: 'ACTIVE',
      });
      prisma.checkoutRequest.findFirst.mockResolvedValue(null);

      // 明天退租，但不满 7 天
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await expect(
        service.create(
          {
            contractId: 'c1',
            expectedCheckoutDate: tomorrow,
          },
          'my-tenant',
        ),
      ).rejects.toThrow(/退租申请需至少提前 7 天/);
    });

    it('成功创建退租申请', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        roomId: 'r1',
        tenantId: 'my-tenant',
        status: 'ACTIVE',
      });
      prisma.checkoutRequest.findFirst.mockResolvedValue(null);
      prisma.checkoutRequest.create.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'CR12345',
        status: 'PENDING',
      });

      const nextMonth = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
      const res = await service.create(
        {
          contractId: 'c1',
          expectedCheckoutDate: nextMonth,
          reasonDetail: '工作调动',
        },
        'my-tenant',
      );

      expect(res.id).toBe('req-1');
      expect(prisma.checkoutRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'c1',
            roomId: 'r1',
            tenantId: 'my-tenant',
            status: 'PENDING',
          }),
        }),
      );
    });
  });

  describe('findAll, findByTenant, findOne', () => {
    it('findAll 支持参数过滤与分页', async () => {
      prisma.checkoutRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);
      prisma.checkoutRequest.count.mockResolvedValue(1);

      const res = await service.findAll({ status: 'PENDING', contractId: 'c1', tenantId: 't1' });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it('findByTenant 支持租客查看本人申请', async () => {
      prisma.checkoutRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);
      prisma.checkoutRequest.count.mockResolvedValue(1);

      const res = await service.findByTenant('t-mine', { status: 'PENDING' });
      expect(res.data).toHaveLength(1);
    });

    it('findOne 找到返回，未找到抛 NotFoundException', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValueOnce({ id: 'req-1' });
      expect((await service.findOne('req-1')).id).toBe('req-1');

      prisma.checkoutRequest.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('none')).rejects.toThrow(NotFoundException);
    });

    it('findOneForTenant 验证租客归属', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', tenantId: 't-mine' });
      expect((await service.findOneForTenant('req-1', 't-mine')).id).toBe('req-1');

      prisma.checkoutRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', tenantId: 't-other' });
      await expect(service.findOneForTenant('req-1', 't-mine')).rejects.toThrow(NotFoundException);
    });
  });

  describe('review', () => {
    it('审核通过并联动生成 CheckoutRecord 草稿', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'CR999',
        contractId: 'c1',
        roomId: 'r1',
        tenantId: 't1',
        status: 'PENDING',
        expectedCheckoutDate: new Date('2026-12-01'),
        tenant: { userId: 'u1' },
      });
      prisma.checkoutRecord.create.mockResolvedValue({ id: 'rec-1' });
      prisma.checkoutRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
        checkoutRecordId: 'rec-1',
      });

      const res = await service.review('req-1', { approved: true }, 'admin-1');
      expect(res.status).toBe('APPROVED');
      expect(prisma.checkoutRecord.create).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          title: expect.stringContaining('退租申请已通过'),
        }),
      );
    });

    it('审核驳回记录原因并通知租客', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'CR999',
        status: 'PENDING',
        tenant: { userId: 'u1' },
      });
      prisma.checkoutRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'REJECTED',
        rejectReason: '租期未满3个月',
      });

      const res = await service.review(
        'req-1',
        { approved: false, rejectReason: '租期未满3个月' },
        'admin-1',
      );
      expect(res.status).toBe('REJECTED');
      expect(prisma.checkoutRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            rejectReason: '租期未满3个月',
          }),
        }),
      );
    });

    it('申请非 PENDING 状态时禁止审批', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });

      await expect(service.review('req-1', { approved: true }, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('租客撤回 PENDING 申请', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        tenantId: 't1',
        status: 'PENDING',
      });
      prisma.checkoutRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'CANCELLED',
      });

      const res = await service.cancel('req-1', 't1');
      expect(res.status).toBe('CANCELLED');
    });

    it('非 PENDING 申请不可撤回', async () => {
      prisma.checkoutRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        tenantId: 't1',
        status: 'APPROVED',
      });

      await expect(service.cancel('req-1', 't1')).rejects.toThrow(ConflictException);
    });
  });
});
