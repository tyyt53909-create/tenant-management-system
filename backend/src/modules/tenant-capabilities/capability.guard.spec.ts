import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { TenantCapabilityService } from './tenant-capability.service.js';

describe('CapabilityGuard', () => {
  let guard: CapabilityGuard;
  let reflector: Reflector;
  let capabilityService: TenantCapabilityService;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn(),
    } as any;

    capabilityService = {
      hasCapability: vi.fn(),
    } as any;

    guard = new CapabilityGuard(reflector, capabilityService);
  });

  function createMockContext(user: any): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ user }),
      }),
    } as any;
  }

  it('接口未标记能力要求时直接放行', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext({ role: 'TENANT', userId: 'u-1' });
    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(capabilityService.hasCapability).not.toHaveBeenCalled();
  });

  it('用户未认证或不存在时放行由后续处理', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');

    const context = createMockContext(undefined);
    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(capabilityService.hasCapability).not.toHaveBeenCalled();
  });

  it('非租客角色（如 ADMIN）直接放行，不受租客能力表约束', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');

    const context = createMockContext({ role: 'ADMIN', userId: 'admin-1' });
    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(capabilityService.hasCapability).not.toHaveBeenCalled();
  });

  it('非租客角色（如 CLEANER）直接放行', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');

    const context = createMockContext({ role: 'CLEANER', userId: 'cleaner-1' });
    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(capabilityService.hasCapability).not.toHaveBeenCalled();
  });

  it('租客角色且具备该能力时放行', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');
    vi.spyOn(capabilityService, 'hasCapability').mockResolvedValue(true);

    const context = createMockContext({ role: 'TENANT', userId: 'tenant-1' });
    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(capabilityService.hasCapability).toHaveBeenCalledWith(
      'tenant-1',
      'tenant.maintenance.create',
    );
  });

  it('接口要求能力但服务未注入时拒绝', async () => {
    const bare = new CapabilityGuard(reflector, undefined);
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');

    const context = createMockContext({ role: 'TENANT', userId: 'tenant-1' });

    await expect(bare.canActivate(context)).rejects.toThrow('CAPABILITY_DENIED');
  });

  it('租客缺少 userId 时拒绝', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');

    const context = createMockContext({ role: 'TENANT' });

    await expect(guard.canActivate(context)).rejects.toThrow('CAPABILITY_DENIED');
    expect(capabilityService.hasCapability).not.toHaveBeenCalled();
  });

  it('租客角色且被屏蔽该能力时抛出 403 CAPABILITY_DENIED 异常', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tenant.maintenance.create');
    vi.spyOn(capabilityService, 'hasCapability').mockResolvedValue(false);

    const context = createMockContext({ role: 'TENANT', userId: 'tenant-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toThrow('CAPABILITY_DENIED');
  });
});
