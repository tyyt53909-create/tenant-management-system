import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { JwtAuthService } from './jwt.service.js';
import { InviteCodeService } from './invite-code.service.js';
import { WechatApiService } from './wechat-api.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import {
  WechatLoginDto,
  WechatBindDto,
  WechatLoginResponseDto,
} from './dto/wechat-auth.dto.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { claimPreCreatedTenant } from './pre-created-tenant.js';
import { normalizePhone } from '../../common/utils/normalize-contact.js';

interface TicketData {
  openid: string;
  unionid?: string;
}

const BIND_TICKET_TTL_SECONDS = 300; // 5 分钟

@Injectable()
export class WechatAuthService {
  private readonly logger = new Logger(WechatAuthService.name);
  private memoryTickets = new Map<string, { data: TicketData; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly jwtService: JwtAuthService,
    private readonly inviteCodeService: InviteCodeService,
    private readonly wechatApiService: WechatApiService,
    private readonly auditLog: AuditLogService,
  ) {}

  getWechatConfig() {
    return {
      appId: this.wechatApiService.getAppId(),
      mockEnabled: this.wechatApiService.isMockEnabled(),
    };
  }

  /**
   * 微信一键登录
   * - 已绑定：直接发放 JWT access/refresh token
   * - 未绑定：抛出 AUTH_WECHAT_UNBOUND 并附带一次性 5 分钟 bindTicket（DEC-03 严禁首次登录自动产生孤儿账号）
   */
  async login(dto: WechatLoginDto): Promise<WechatLoginResponseDto> {
    const { openid, unionid } = await this.wechatApiService.jscode2session(dto.code);

    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'WECHAT_MP',
          providerUserId: openid,
        },
      },
      include: {
        user: {
          include: { tenant: true },
        },
      },
    });

    if (identity && identity.user) {
      const user = identity.user;
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.userIdentity.update({
          where: { id: identity.id },
          data: {
            unionId: unionid ?? identity.unionId,
            lastUsedAt: new Date(),
          },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
      });

      await this.auditLog.log({
        userId: user.id,
        action: 'WECHAT_LOGIN',
        entityType: 'user',
        entityId: user.id,
        changes: { openidMasked: this.maskOpenId(openid) },
      });

      const tokens = await this.jwtService.generateTokens({
        sub: user.id,
        role: user.role,
      });

      return {
        isBound: true,
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          avatarUrl: user.avatarUrl,
        },
      };
    }

    // 未绑定：生成一次性 5 分钟 bindTicket
    const bindTicket = `wt_${randomBytes(24).toString('hex')}`;
    await this.saveBindTicket(bindTicket, { openid, unionid });

    await this.auditLog.log({
      action: 'WECHAT_LOGIN_UNBOUND',
      entityType: 'wechat',
      entityId: this.maskOpenId(openid),
      changes: { openidMasked: this.maskOpenId(openid) },
    });

    throw apiError(ErrorCode.AUTH_WECHAT_UNBOUND, '微信账号未绑定租客身份，请先绑定预建租客', {
      bindTicket,
    });
  }

  /**
   * 微信账号绑定并完成首次登录
   * 支持两条路径：
   * 1. 邀请码绑定（inviteCode）
   * 2. 手机号精确匹配绑定（phoneCode -> getPhoneNumber）
   */
  async bind(dto: WechatBindDto): Promise<WechatLoginResponseDto> {
    if (!dto.bindTicket?.trim()) {
      throw new BadRequestException('缺少绑定凭据 bindTicket');
    }

    if (!dto.inviteCode?.trim() && !dto.phoneCode?.trim()) {
      throw new BadRequestException('请提供邀请码或手机号快速验证凭证');
    }

    // 原子消费 bindTicket，防重放
    const ticketData = await this.consumeBindTicket(dto.bindTicket.trim());
    if (!ticketData) {
      throw apiError(
        ErrorCode.AUTH_CLAIM_REVERIFY,
        '绑定凭据已失效或已被使用，请重新发起微信登录',
      );
    }

    const { openid, unionid } = ticketData;

    // 二次防御：该 openid 是否在并发中已被绑定
    const existingIdentity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'WECHAT_MP',
          providerUserId: openid,
        },
      },
    });
    if (existingIdentity) {
      throw apiError(ErrorCode.COMMON_CONFLICT, '该微信账号已被其他用户绑定');
    }

    let authenticatedUser: {
      id: string;
      email: string | null;
      phone: string | null;
      role: UserRole;
      avatarUrl?: string | null;
    };

    if (dto.phoneCode?.trim()) {
      // 路径 A：手机号快速验证匹配
      const rawPhone = await this.wechatApiService.getPhoneNumber(dto.phoneCode.trim());
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        throw new BadRequestException('微信获取的手机号格式无效');
      }

      // 检查系统中是否已有该手机号的用户
      const existingUser = await this.prisma.user.findFirst({
        where: { phone },
      });

      if (existingUser) {
        if (!existingUser.isActive) {
          throw new ForbiddenException('账号已被禁用');
        }

        authenticatedUser = await this.prisma.$transaction(async (tx) => {
          await tx.userIdentity.create({
            data: {
              userId: existingUser.id,
              provider: 'WECHAT_MP',
              providerUserId: openid,
              unionId: unionid ?? null,
              lastUsedAt: new Date(),
            },
          });
          return tx.user.update({
            where: { id: existingUser.id },
            data: { lastLoginAt: new Date() },
          });
        });
      } else {
        // 未建 User，查询未绑定的预建租客档案（userId 为 null）
        const preTenants = await this.prisma.tenant.findMany({
          where: { phone, userId: null },
        });

        if (preTenants.length === 0) {
          throw apiError(
            ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED,
            `未找到手机号 ${phone} 对应的未绑定租客档案，请联系管家开通`,
          );
        }
        if (preTenants.length > 1) {
          throw apiError(
            ErrorCode.COMMON_CONFLICT,
            `手机号 ${phone} 匹配到多份未绑定的租客档案，请联系管家确认`,
          );
        }

        const targetTenant = preTenants[0];

        authenticatedUser = await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              phone,
              email: targetTenant.email ?? null,
              role: 'TENANT',
              isActive: true,
              lastLoginAt: new Date(),
            },
          });

          await tx.userIdentity.create({
            data: {
              userId: user.id,
              provider: 'WECHAT_MP',
              providerUserId: openid,
              unionId: unionid ?? null,
              lastUsedAt: new Date(),
            },
          });

          await claimPreCreatedTenant(tx, targetTenant.id, user.id);
          return user;
        });
      }
    } else {
      // 路径 B：邀请码绑定
      const inviteCode = dto.inviteCode!.trim();
      const validation = await this.inviteCodeService.validateInviteCode(inviteCode);
      if (!validation.valid) {
        throw apiError(ErrorCode.AUTH_INVITE_CODE_INVALID, '邀请码无效或已失效');
      }

      if (validation.role !== 'TENANT' || !validation.tenantId) {
        throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED, '微信绑定仅限预建租客邀请码');
      }

      const tenantId = validation.tenantId;

      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
        });
        if (!tenant || tenant.userId) {
          throw apiError(ErrorCode.AUTH_PROFILE_ALREADY_BOUND);
        }

        const user = await tx.user.create({
          data: {
            phone: tenant.phone ?? null,
            email: tenant.email ?? null,
            role: 'TENANT',
            invitedBy: validation.invitedBy ?? null,
            isActive: true,
            lastLoginAt: new Date(),
          },
        });

        await tx.userIdentity.create({
          data: {
            userId: user.id,
            provider: 'WECHAT_MP',
            providerUserId: openid,
            unionId: unionid ?? null,
            lastUsedAt: new Date(),
          },
        });

        await claimPreCreatedTenant(tx, tenantId, user.id);
        await this.inviteCodeService.consumeInviteCode(inviteCode, user.id, tx);
        return user;
      });
    }

    await this.auditLog.log({
      userId: authenticatedUser.id,
      action: 'WECHAT_BIND',
      entityType: 'user',
      entityId: authenticatedUser.id,
      changes: {
        openidMasked: this.maskOpenId(openid),
        method: dto.phoneCode ? 'PHONE' : 'INVITE_CODE',
      },
    });

    const tokens = await this.jwtService.generateTokens({
      sub: authenticatedUser.id,
      role: authenticatedUser.role,
    });

    return {
      isBound: true,
      ...tokens,
      user: {
        id: authenticatedUser.id,
        email: authenticatedUser.email,
        phone: authenticatedUser.phone,
        role: authenticatedUser.role,
        avatarUrl: authenticatedUser.avatarUrl,
      },
    };
  }

  private async saveBindTicket(ticket: string, data: TicketData): Promise<void> {
    const key = `wechat:bind_ticket:${ticket}`;
    const value = JSON.stringify(data);
    if (this.redisService.ready && this.redisService.client) {
      try {
        await this.redisService.client.set(
          key,
          value,
          'PX',
          BIND_TICKET_TTL_SECONDS * 1000,
        );
        return;
      } catch {
        // fallback to memory
      }
    }
    this.memoryTickets.set(ticket, {
      data,
      expiresAt: Date.now() + BIND_TICKET_TTL_SECONDS * 1000,
    });
  }

  private async consumeBindTicket(ticket: string): Promise<TicketData | null> {
    const key = `wechat:bind_ticket:${ticket}`;
    if (this.redisService.ready && this.redisService.client) {
      try {
        const raw = await this.redisService.client.get(key);
        if (raw) {
          await this.redisService.client.del(key);
          return JSON.parse(raw) as TicketData;
        }
        return null;
      } catch {
        // fallback to memory
      }
    }

    const item = this.memoryTickets.get(ticket);
    if (!item) return null;
    this.memoryTickets.delete(ticket);
    if (Date.now() > item.expiresAt) return null;
    return item.data;
  }

  private maskOpenId(openid: string): string {
    if (!openid || openid.length < 8) return '***';
    return `${openid.slice(0, 4)}****${openid.slice(-4)}`;
  }
}
