import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { JwtAuthService } from '../auth/jwt.service.js';
import {
  TENANT_CAPABILITIES,
  isValidCapabilityCode,
  TenantCapabilityCode,
} from './tenant-capability.catalog.js';

@Injectable()
export class TenantCapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    @Optional() @Inject(JwtAuthService) private readonly jwtAuthService?: JwtAuthService,
  ) {}

  /**
   * 计算指定用户的实际生效能力列表（用于 GET /auth/me 与客户端入口控制）
   */
  async getEffectiveCapabilities(userId: string): Promise<string[]> {
    const overrides = await this.prisma.userCapabilityOverride.findMany({
      where: { userId },
    });

    const overrideMap = new Map<string, 'ALLOW' | 'DENY'>();
    for (const ov of overrides) {
      overrideMap.set(ov.capability, ov.effect);
    }

    const effective: string[] = [];
    for (const cap of TENANT_CAPABILITIES) {
      const overrideEffect = overrideMap.get(cap.code);
      if (overrideEffect === 'DENY') {
        continue;
      }
      // ALLOW 或无覆写（默认允许）
      effective.push(cap.code);
    }

    return effective;
  }

  /**
   * 判断租客是否拥有某项能力（守卫快速判定）
   */
  async hasCapability(userId: string, capability: string): Promise<boolean> {
    if (!isValidCapabilityCode(capability)) {
      return false;
    }

    const override = await this.prisma.userCapabilityOverride.findUnique({
      where: {
        userId_capability: {
          userId,
          capability,
        },
      },
    });

    if (override) {
      return override.effect === 'ALLOW';
    }

    // 默认均为 ALLOW
    return true;
  }

  /**
   * 获取租客的登录账号状态（GET /tenants/:id/account）
   */
  async getAccount(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    if (!tenant.user) {
      return { status: 'UNREGISTERED' as const };
    }

    return {
      status: 'REGISTERED' as const,
      userId: tenant.user.id,
      email: tenant.user.email,
      phone: tenant.user.phone,
      isActive: tenant.user.isActive,
      lastLoginAt: tenant.user.lastLoginAt,
      createdAt: tenant.user.createdAt,
    };
  }

  /**
   * 变更租客账号的启用/禁用状态（PATCH /tenants/:id/account）
   */
  async updateAccount(
    tenantId: string,
    isActive: boolean,
    actorId: string,
    ip: string,
    userAgent: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    if (!tenant.user) {
      throw new ConflictException('租客尚未注册账号');
    }

    const beforeState = tenant.user.isActive;

    if (beforeState !== isActive) {
      await this.prisma.user.update({
        where: { id: tenant.user.id },
        data: { isActive },
      });

      if (!isActive) {
        await this.jwtAuthService?.revokeUserSessions(tenant.user.id);
      }

      await this.auditLogService.log({
        userId: actorId,
        action: isActive ? 'ENABLE_TENANT_ACCOUNT' : 'DISABLE_TENANT_ACCOUNT',
        entityType: 'User',
        entityId: tenant.user.id,
        changes: {
          before: { isActive: beforeState },
          after: { isActive },
        },
        ip: ip || '127.0.0.1',
        userAgent: userAgent || '',
      });
    }

    return {
      success: true,
      isActive,
    };
  }

  /**
   * 获取租客能力配置详情（GET /tenants/:id/capabilities）
   */
  async getCapabilities(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    if (!tenant.user) {
      return {
        status: 'UNREGISTERED' as const,
        catalog: TENANT_CAPABILITIES,
        overrides: [],
        effectiveCapabilities: [],
      };
    }

    const [overrides, effectiveCapabilities] = await Promise.all([
      this.prisma.userCapabilityOverride.findMany({
        where: { userId: tenant.user.id },
        orderBy: { capability: 'asc' },
      }),
      this.getEffectiveCapabilities(tenant.user.id),
    ]);

    return {
      status: 'REGISTERED' as const,
      userId: tenant.user.id,
      catalog: TENANT_CAPABILITIES,
      overrides: overrides.map((o) => ({
        capability: o.capability,
        effect: o.effect,
        reason: o.reason,
        grantedBy: o.grantedBy,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
      effectiveCapabilities,
    };
  }

  /**
   * 整批替换租客能力的 DENY 覆盖设置（PUT /tenants/:id/capabilities）
   */
  async replaceCapabilities(
    tenantId: string,
    denied: string[],
    actorId: string,
    reasons?: Record<string, string>,
    ip?: string,
    userAgent?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    if (!tenant.user) {
      throw new ConflictException('租客尚未注册账号');
    }

    // 校验 1：重复代码检验
    if (new Set(denied).size !== denied.length) {
      throw new BadRequestException('存在重复的能力代码');
    }

    // 校验 2：清单合法性检验
    for (const code of denied) {
      if (!isValidCapabilityCode(code)) {
        throw new BadRequestException(`未知能力代码: ${code}`);
      }
    }

    const userId = tenant.user.id;

    // 获取现有覆写对比变化
    const oldOverrides = await this.prisma.userCapabilityOverride.findMany({
      where: { userId },
    });

    const oldDeniedOverrides = oldOverrides.filter((o) => o.effect === 'DENY');
    const oldDenied = oldDeniedOverrides.map((o) => o.capability);
    const oldReason = new Map(
      oldDeniedOverrides.map((o) => [o.capability, o.reason ?? null]),
    );

    // 未传 reasons 时保留仍在屏蔽名单里的原因，不能当成清空。
    const nextReason = new Map<string, string | null>();
    for (const code of denied) {
      nextReason.set(
        code,
        reasons ? this.normalizeReason(reasons[code]) : (oldReason.get(code) ?? null),
      );
    }

    const sameDenied =
      oldReason.size === denied.length && denied.every((code) => oldReason.has(code));
    const sameReasons = denied.every(
      (code) => (oldReason.get(code) ?? null) === (nextReason.get(code) ?? null),
    );
    const hasNonDeny = oldOverrides.some((o) => o.effect !== 'DENY');

    if (sameDenied && sameReasons && !hasNonDeny) {
      return this.getCapabilities(tenantId);
    }

    const afterReasons: Record<string, string | null> = {};
    for (const code of denied) {
      afterReasons[code] = nextReason.get(code) ?? null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userCapabilityOverride.deleteMany({
        where: { userId },
      });

      for (const code of denied) {
        await tx.userCapabilityOverride.create({
          data: {
            userId,
            capability: code,
            effect: 'DENY',
            reason: nextReason.get(code) ?? null,
            grantedBy: actorId,
          },
        });
      }
    });

    await this.auditLogService.log({
      userId: actorId,
      action: 'UPDATE_TENANT_CAPABILITIES',
      entityType: 'User',
      entityId: userId,
      changes: {
        before: { denied: oldDenied },
        after: { denied, reasons: afterReasons },
      },
      ip: ip || '127.0.0.1',
      userAgent: userAgent || '',
    });

    return this.getCapabilities(tenantId);
  }

  private normalizeReason(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  }
}
