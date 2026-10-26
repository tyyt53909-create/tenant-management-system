import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { CheckoutRequestsService } from './checkout-requests.service.js';
import { ConflictException } from '@nestjs/common';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

describe('CheckoutController', () => {
  let controller: CheckoutController;
  let service: CheckoutService;
  let requestsService: any;

  beforeEach(async () => {
    requestsService = {
      create: vi.fn().mockResolvedValue({ id: 'req-1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'req-1' }),
      findOneForTenant: vi.fn().mockResolvedValue({ id: 'req-1' }),
      review: vi.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
      cancel: vi.fn().mockResolvedValue({ id: 'req-1', status: 'CANCELLED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        { provide: BusinessClock, useValue: { formatDate: () => '2026-10-24' } },
        {
          provide: CheckoutService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findByTenant: vi.fn(),
            findOne: vi.fn(),
            findOneForTenant: vi.fn(),
            getVoucher: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            exportCheckouts: vi.fn().mockResolvedValue('a,b,c'),
          },
        },
        {
          provide: CheckoutRequestsService,
          useValue: requestsService,
        },
      ],
    }).compile();

    controller = module.get<CheckoutController>(CheckoutController);
    service = module.get<CheckoutService>(CheckoutService);
  });

  it('create：透传结算 DTO（含 items）并交由服务层落库', async () => {
    const dto = {
      contractId: 'contract-1',
      roomId: 'room-1',
      checkoutDate: '2026-10-13',
      totalRefund: 100000,
      processedBy: 'admin-1',
      items: [{ itemType: 'DEPOSIT_DEDUCTION', description: '墙面破损', amount: 80000 }],
    } as any;
    vi.spyOn(service, 'create').mockResolvedValue({ id: 'checkout-1', items: dto.items } as any);

    const result = await controller.create(dto);

    expect(result.id).toBe('checkout-1');
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll：管理员走全量查询', async () => {
    vi.spyOn(service, 'findAll').mockResolvedValue({ data: [], meta: {} } as any);
    const spyFindByTenant = vi.spyOn(service, 'findByTenant');

    await controller.findAll({ user: { role: 'ADMIN' } }, { page: 1, limit: 20 } as any);

    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(spyFindByTenant).not.toHaveBeenCalled();
  });

  it('findAll：租客强制走自己的记录（服务端隔离）', async () => {
    vi.spyOn(service, 'findByTenant').mockResolvedValue({ data: [], meta: {} } as any);
    const spyFindAll = vi.spyOn(service, 'findAll');

    await controller.findAll(
      { user: { role: 'TENANT', tenantId: 'tenant-1' } },
      { page: 1, limit: 20 } as any,
    );

    expect(service.findByTenant).toHaveBeenCalledWith('tenant-1', { page: 1, limit: 20 });
    expect(spyFindAll).not.toHaveBeenCalled();
  });

  it('findOne：租客走 findOneForTenant（越权 404）', async () => {
    vi.spyOn(service, 'findOneForTenant').mockResolvedValue({ id: 'checkout-1' } as any);
    const spyFindOne = vi.spyOn(service, 'findOne');

    await controller.findOne({ user: { role: 'TENANT', tenantId: 'tenant-1' } }, 'checkout-1');

    expect(service.findOneForTenant).toHaveBeenCalledWith('checkout-1', 'tenant-1');
    expect(spyFindOne).not.toHaveBeenCalled();
  });

  it('findOne：管理员走全量查询', async () => {
    vi.spyOn(service, 'findOne').mockResolvedValue({ id: 'checkout-1' } as any);

    await controller.findOne({ user: { role: 'ADMIN' } }, 'checkout-1');

    expect(service.findOne).toHaveBeenCalledWith('checkout-1');
  });

  it('update：透传更新 DTO', async () => {
    vi.spyOn(service, 'update').mockResolvedValue({ id: 'checkout-1', status: 'COMPLETED' } as any);

    const result = await controller.update('checkout-1', { status: 'COMPLETED' } as any);

    expect(result.status).toBe('COMPLETED');
    expect(service.update).toHaveBeenCalledWith('checkout-1', { status: 'COMPLETED' });
  });

  it('remove：财务凭证禁止硬删除（透传 409）', async () => {
    vi.spyOn(service, 'remove').mockRejectedValue(
      new ConflictException('退租结算单是财务凭证，只能取消（PATCH status=CANCELLED），不能删除'),
    );

    await expect(controller.remove('checkout-1')).rejects.toThrow(ConflictException);
    expect(service.remove).toHaveBeenCalledWith('checkout-1');
  });

  it('getVoucher：管理员不限 tenantId，租客透传 req.user.tenantId', async () => {
    vi.spyOn(service, 'getVoucher').mockResolvedValue({ id: 'voucher-1' } as any);

    // ADMIN
    await controller.getVoucher({ user: { role: 'ADMIN' } }, 'chk-1');
    expect(service.getVoucher).toHaveBeenCalledWith('chk-1', undefined);

    // TENANT
    await controller.getVoucher({ user: { role: 'TENANT', tenantId: 'tenant-1' } }, 'chk-1');
    expect(service.getVoucher).toHaveBeenCalledWith('chk-1', 'tenant-1');
  });

  describe('退租申请端点', () => {
    it('createRequest 透传租客输入与 tenantId', async () => {
      const dto = { contractId: 'c1', expectedCheckoutDate: '2026-12-01' } as any;
      const res = await controller.createRequest(dto, { user: { role: 'TENANT', tenantId: 't1' } });
      expect(res.id).toBe('req-1');
      expect(requestsService.create).toHaveBeenCalledWith(dto, 't1');
    });

    it('findMyRequests 分别处理租客与管理员', async () => {
      await controller.findMyRequests({ user: { role: 'TENANT', tenantId: 't1' } }, {});
      expect(requestsService.findByTenant).toHaveBeenCalledWith('t1', {});

      await controller.findMyRequests({ user: { role: 'ADMIN' } }, {});
      expect(requestsService.findAll).toHaveBeenCalledWith({});
    });

    it('findAllRequests 仅管理员', async () => {
      await controller.findAllRequests({});
      expect(requestsService.findAll).toHaveBeenCalledWith({});
    });

    it('findOneRequest 分别处理租客与管理员', async () => {
      await controller.findOneRequest('req-1', { user: { role: 'TENANT', tenantId: 't1' } });
      expect(requestsService.findOneForTenant).toHaveBeenCalledWith('req-1', 't1');

      await controller.findOneRequest('req-1', { user: { role: 'ADMIN' } });
      expect(requestsService.findOne).toHaveBeenCalledWith('req-1');
    });

    it('reviewRequest 透传管理员审核', async () => {
      const dto = { approved: true };
      const res = await controller.reviewRequest('req-1', dto, { user: { userId: 'admin-1' } });
      expect(res.status).toBe('APPROVED');
      expect(requestsService.review).toHaveBeenCalledWith('req-1', dto, 'admin-1');
    });

    it('cancelRequest 透传租客撤回', async () => {
      const res = await controller.cancelRequest('req-1', { user: { tenantId: 't1' } });
      expect(res.status).toBe('CANCELLED');
      expect(requestsService.cancel).toHaveBeenCalledWith('req-1', 't1');
    });
  });
});
