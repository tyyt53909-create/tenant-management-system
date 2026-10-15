import { Test, TestingModule } from '@nestjs/testing';
import { TenantCapabilitiesController } from './tenant-capabilities.controller.js';
import { TenantCapabilityService } from './tenant-capability.service.js';

describe('TenantCapabilitiesController', () => {
  let controller: TenantCapabilitiesController;
  let service: TenantCapabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantCapabilitiesController],
      providers: [
        {
          provide: TenantCapabilityService,
          useValue: {
            getAccount: vi.fn(),
            updateAccount: vi.fn(),
            getCapabilities: vi.fn(),
            replaceCapabilities: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TenantCapabilitiesController>(TenantCapabilitiesController);
    service = module.get<TenantCapabilityService>(TenantCapabilityService);
  });

  it('getAccount 透传 tenantId 到服务层', async () => {
    vi.spyOn(service, 'getAccount').mockResolvedValue({ status: 'UNREGISTERED' } as any);

    const res = await controller.getAccount('t-1');
    expect(res).toEqual({ status: 'UNREGISTERED' });
    expect(service.getAccount).toHaveBeenCalledWith('t-1');
  });

  it('updateAccount 正确提取操作者与请求网络凭证', async () => {
    vi.spyOn(service, 'updateAccount').mockResolvedValue({ success: true, isActive: false } as any);

    const req = {
      user: { userId: 'admin-99' },
      ip: '192.168.1.10',
      headers: { 'user-agent': 'AdminDashboard' },
    };

    const res = await controller.updateAccount('t-1', { isActive: false }, req);
    expect(res).toEqual({ success: true, isActive: false });
    expect(service.updateAccount).toHaveBeenCalledWith(
      't-1',
      false,
      'admin-99',
      '192.168.1.10',
      'AdminDashboard',
    );
  });

  it('getCapabilities 透传 tenantId 到服务层', async () => {
    vi.spyOn(service, 'getCapabilities').mockResolvedValue({
      status: 'REGISTERED',
      catalog: [],
      overrides: [],
      effectiveCapabilities: [],
    } as any);

    const res = await controller.getCapabilities('t-1');
    expect(res.status).toBe('REGISTERED');
    expect(service.getCapabilities).toHaveBeenCalledWith('t-1');
  });

  it('updateCapabilities 正确解析请求体与变更参数', async () => {
    vi.spyOn(service, 'replaceCapabilities').mockResolvedValue({ status: 'REGISTERED' } as any);

    const req = {
      user: { userId: 'admin-99' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Chrome' },
    };

    const dto = {
      denied: ['tenant.maintenance.create'],
      reasons: { 'tenant.maintenance.create': '滥用报修' },
    };

    const res = await controller.updateCapabilities('t-1', dto, req);
    expect(res.status).toBe('REGISTERED');
    expect(service.replaceCapabilities).toHaveBeenCalledWith(
      't-1',
      ['tenant.maintenance.create'],
      'admin-99',
      { 'tenant.maintenance.create': '滥用报修' },
      '127.0.0.1',
      'Chrome',
    );
  });
});
