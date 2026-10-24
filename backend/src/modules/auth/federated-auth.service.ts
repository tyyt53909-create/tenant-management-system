import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { EmailOtpService } from './email-otp.service.js';
import { JwtAuthService } from './jwt.service.js';
import { InviteCodeService } from './invite-code.service.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';

interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  avatarUrl?: string | null;
}

interface PreCreatedIdentity {
  email?: string | null;
  phone?: string | null;
}

@Injectable()
export class FederatedAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailOtpService: EmailOtpService,
    private readonly jwtService: JwtAuthService,
    private readonly inviteCodeService: InviteCodeService,
  ) {}

  getGoogleClientId() {
    return {
      clientId: this.googleAuthService.getClientId(),
      // 前端据此决定是否显示「模拟 Google 登录」开发者通道（T206：后端不再仅凭 NODE_ENV 放行 mock）
      mockEnabled: this.googleAuthService.isMockEnabled(),
    };
  }

  async googleAuth(dto: GoogleAuthDto): Promise<GoogleAuthResponseDto> {
    // 1. 验证 Google idToken，邮箱必须显式验证通过（不再把缺失当 true）
    const googleUser = await this.googleAuthService.verifyIdToken(dto.idToken);
    if (!googleUser.emailVerified) {
      throw apiError(ErrorCode.AUTH_GOOGLE_EMAIL_UNVERIFIED);
    }

    const email = googleUser.email.toLowerCase().trim();

    // 2. 先按 UserIdentity 查，兼容旧 User.googleId
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId },
          { identities: { some: { provider: 'GOOGLE', providerUserId: googleUser.googleId } } },
        ],
      },
      include: { tenant: true },
    });

    let authenticatedUser: AuthenticatedUser;
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
      }

      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        await this.upsertIdentity(tx, {
          userId: user.id,
          provider: 'GOOGLE',
          providerUserId: googleUser.googleId,
          email,
        });
        return tx.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId ?? googleUser.googleId,
            avatarUrl: user.avatarUrl ?? googleUser.avatarUrl,
            lastLoginAt: new Date(),
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
        });
      });
    } else {
      // 3. 新账号：必须同时有邀请码与同邮箱预建租客，否则拒绝（DEC-03）
      if (!dto.inviteCode) {
        throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED);
      }
      const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
      if (!validation.valid) {
        throw apiError(ErrorCode.AUTH_INVITE_CODE_INVALID);
      }
      const preTenant = await this.findPreCreatedTenant({ email });
      if (!preTenant) {
        throw apiError(
          ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED,
          '该邮箱没有预建租客档案，请联系管理员先建档再邀请',
        );
      }

      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            googleId: googleUser.googleId,
            avatarUrl: googleUser.avatarUrl,
            role: validation.role ?? 'TENANT',
            invitedBy: validation.invitedBy ?? null,
            isActive: true,
            lastLoginAt: new Date(),
            emailVerifiedAt: new Date(),
          },
        });

        await tx.userIdentity.create({
          data: {
            userId: created.id,
            provider: 'GOOGLE',
            providerUserId: googleUser.googleId,
            email,
            emailVerifiedAt: new Date(),
            lastUsedAt: new Date(),
          },
        });

        await tx.tenant.update({
          where: { id: preTenant.id },
          data: { userId: created.id },
        });

        await this.inviteCodeService.consumeInviteCode(dto.inviteCode!, created.id, tx);
        return created;
      });
      isNewUser = true;
    }

    // 4. 生成 JWT Token
    const tokens = await this.jwtService.generateTokens({
      sub: authenticatedUser.id,
      role: authenticatedUser.role,
    });

    return {
      ...tokens,
      user: {
        id: authenticatedUser.id,
        email: authenticatedUser.email,
        phone: authenticatedUser.phone,
        role: authenticatedUser.role,
        avatarUrl: authenticatedUser.avatarUrl,
      },
      isNewUser,
    };
  }

  async sendEmailCode(dto: SendEmailCodeDto) {
    const result = await this.emailOtpService.sendCode(dto.email);
    return {
      message: '验证码已发送至您的邮箱，5分钟内有效',
      cooldown: result.cooldown,
    };
  }

  async loginWithEmailCode(dto: LoginEmailCodeDto) {
    // 1. 校验验证码
    const isValid = await this.emailOtpService.verifyCode(dto.email, dto.code);
    if (!isValid) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const email = dto.email.toLowerCase().trim();

    // 2. 查询用户
    const user = await this.prisma.user.findFirst({
      where: { email },
      include: { tenant: true },
    });

    let authenticatedUser: AuthenticatedUser;
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
      }

      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        await this.upsertIdentity(tx, {
          userId: user.id,
          provider: 'EMAIL',
          providerUserId: email,
          email,
        });
        return tx.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
        });
      });
    } else {
      // 3. 新账号：必须同时有邀请码与同邮箱预建租客（DEC-03，不再自动建 Tenant）
      if (!dto.inviteCode) {
        throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED);
      }
      const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
      if (!validation.valid) {
        throw apiError(ErrorCode.AUTH_INVITE_CODE_INVALID);
      }
      const preTenant = await this.findPreCreatedTenant({ email });
      if (!preTenant) {
        throw apiError(
          ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED,
          '该邮箱没有预建租客档案，请联系管理员先建档再邀请',
        );
      }

      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            role: validation.role ?? 'TENANT',
            invitedBy: validation.invitedBy ?? null,
            isActive: true,
            lastLoginAt: new Date(),
            emailVerifiedAt: new Date(),
          },
        });

        await tx.userIdentity.create({
          data: {
            userId: created.id,
            provider: 'EMAIL',
            providerUserId: email,
            email,
            emailVerifiedAt: new Date(),
            lastUsedAt: new Date(),
          },
        });

        await tx.tenant.update({
          where: { id: preTenant.id },
          data: { userId: created.id },
        });

        await this.inviteCodeService.consumeInviteCode(dto.inviteCode!, created.id, tx);
        return created;
      });
      isNewUser = true;
    }

    // 4. 签发 Token
    const tokens = await this.jwtService.generateTokens({
      sub: authenticatedUser.id,
      role: authenticatedUser.role,
    });

    return {
      ...tokens,
      user: {
        id: authenticatedUser.id,
        email: authenticatedUser.email,
        phone: authenticatedUser.phone,
        role: authenticatedUser.role,
        avatarUrl: authenticatedUser.avatarUrl,
      },
      isNewUser,
    };
  }

  async bindInviteCode(userId: string, dto: BindInviteCodeDto) {
    const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
    if (!validation.valid) {
      throw new BadRequestException('邀请码无效或已过期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user) {
      throw apiError(ErrorCode.COMMON_RESOURCE_NOT_FOUND, '用户不存在');
    }

    // 不允许用邀请码改写非 TENANT 账号的角色（防止降权/提权混乱）
    if (validation.role && user.role !== 'TENANT' && validation.role !== user.role) {
      throw apiError(ErrorCode.AUTH_IDENTITY_ROLE_CONFLICT);
    }

    const preTenant = user.tenant
      ? null
      : await this.findPreCreatedTenant({ email: user.email, phone: user.phone });

    await this.prisma.$transaction(async (tx) => {
      if (preTenant) {
        await tx.tenant.update({
          where: { id: preTenant.id },
          data: { userId },
        });
      }

      const data: Prisma.UserUpdateInput = {};
      if (validation.invitedBy) {
        data.invitedBy = validation.invitedBy;
      }
      if (validation.role && user.role === 'TENANT') {
        data.role = validation.role;
      }
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: userId }, data });
      }

      // 邀请码一次性失效
      await this.inviteCodeService.consumeInviteCode(dto.inviteCode, userId, tx);
    });

    return {
      success: true,
      message: '邀请码兑换成功，房源身份已成功关联！',
    };
  }

  /** 查找尚未绑定用户、且邮箱/手机号精确匹配的预建租客档案。 */
  private async findPreCreatedTenant(identity: PreCreatedIdentity) {
    const conditions: Prisma.TenantWhereInput[] = [];
    if (identity.email?.trim()) {
      conditions.push({ email: identity.email.trim().toLowerCase() });
    }
    if (identity.phone?.trim()) {
      conditions.push({ phone: identity.phone.trim() });
    }
    if (conditions.length === 0) {
      return null;
    }
    return this.prisma.tenant.findFirst({
      where: { userId: null, OR: conditions },
    });
  }

  /** 补建/刷新外部身份；EMAIL 与 GOOGLE 都走同一张表。 */
  private async upsertIdentity(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      provider: 'GOOGLE' | 'EMAIL';
      providerUserId: string;
      email: string;
    },
  ): Promise<void> {
    await tx.userIdentity.upsert({
      where: {
        provider_providerUserId: {
          provider: params.provider,
          providerUserId: params.providerUserId,
        },
      },
      create: {
        userId: params.userId,
        provider: params.provider,
        providerUserId: params.providerUserId,
        email: params.email,
        emailVerifiedAt: new Date(),
        lastUsedAt: new Date(),
      },
      update: {
        email: params.email,
        emailVerifiedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });
  }
}
