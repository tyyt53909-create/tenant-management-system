import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy.js';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * 安全回归（T158）：TENANT 账号没有租客档案时必须拒绝鉴权。
 *
 * 背景：jt strategy 原先在查不到 Tenant 时仍返回 tenantId=undefined，
 * 下游 `where: { tenantId: undefined }` 被 Prisma 当作「不过滤」，
 * 实测可越权读取全库 49 张账单 / 35 份合同 / 任意预付账户。
 */
describe('JwtStrategy 租客档案强制校验（T158 安全回归）', () => {
  let strategy: JwtStrategy;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      user: { findUnique: vi.fn() },
      tenant: { findUnique: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue('test-secret') } },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prisma = prismaMock;
  });

  it('TENANT 有档案 → 返回 tenantId', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'TENANT', isActive: true });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

    const res = await strategy.validate({ sub: 'u-1', role: 'TENANT' } as any);

    expect(res.tenantId).toBe('tenant-1');
  });

  it('TENANT 无档案 → 401（不得放行 tenantId=undefined）', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1', role: 'TENANT', isActive: true });
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'u-1', role: 'TENANT' } as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('ADMIN 不查租客档案，且 tenantId 为 undefined', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-2', role: 'ADMIN', isActive: true });

    const res = await strategy.validate({ sub: 'u-2', role: 'ADMIN' } as any);

    expect(res.tenantId).toBeUndefined();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('用户不存在或已禁用 → 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'x', role: 'TENANT' } as any)).rejects.toThrow(
      UnauthorizedException,
    );

    prisma.user.findUnique.mockResolvedValue({ id: 'u-3', role: 'TENANT', isActive: false });
    await expect(strategy.validate({ sub: 'u-3', role: 'TENANT' } as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
