import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { EmailOtpService } from './email-otp.service.js';
import { JwtAuthService } from './jwt.service.js';
import { InviteCodeService } from './invite-code.service.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';

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
    // 1. 验证 Google idToken
    const googleUser = await this.googleAuthService.verifyIdToken(dto.idToken);
    // 即使上游漏检，未验证邮箱也不得按 email 命中已有账号或领走预建租客档案。
    if (googleUser.emailVerified !== true) {
      throw new UnauthorizedException('Google 账号邮箱未验证，拒绝登录');
    }

    // 2. 检查用户是否已存在（按 googleId 或 email 匹配）
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId },
          { email: googleUser.email },
        ],
      },
      include: { tenant: true },
    });

    let authenticatedUser: {
      id: string;
      email: string | null;
      phone: string | null;
      role: UserRole;
      avatarUrl?: string | null;
    };
    let isNewUser = false;

    if (user) {
      // 用户已存在
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
      }

      // 如果尚未关联 googleId 或 avatarUrl，补充关联
      if (!user.googleId || !user.avatarUrl) {
        authenticatedUser = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: user.googleId || googleUser.googleId,
            avatarUrl: user.avatarUrl || googleUser.avatarUrl,
            lastLoginAt: new Date(),
          },
        });
      } else {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        authenticatedUser = user;
      }
    } else {
      // 用户不存在：首次使用 Google 登录，零门槛自动创建账户
      let invitedBy: string | null = null;
      if (dto.inviteCode) {
        const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
        if (validation.valid) {
          invitedBy = validation.invitedBy || null;
        }
      }

      // 事务创建 User 和 Tenant
      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: googleUser.email,
            googleId: googleUser.googleId,
            avatarUrl: googleUser.avatarUrl,
            role: 'TENANT',
            invitedBy,
            isActive: true,
            lastLoginAt: new Date(),
          },
        });

        const tenantPhone = `pending-${newUser.id}`;

        if (dto.inviteCode) {
          await this.inviteCodeService.consumeInviteCode(dto.inviteCode, newUser.id, tx);
        }

        // 检查是否有管理员预创建的租客档案（userId 为空）
        const preCreatedTenant = await tx.tenant.findFirst({
          where: { email: googleUser.email, userId: null },
        });

        if (preCreatedTenant) {
          await tx.tenant.update({
            where: { id: preCreatedTenant.id },
            data: { userId: newUser.id },
          });
        } else {
          await tx.tenant.create({
            data: {
              userId: newUser.id,
              name: googleUser.name || googleUser.email.split('@')[0],
              phone: tenantPhone,
              email: googleUser.email,
              emergencyContact: '',
              emergencyPhone: '',
            },
          });
        }

        return newUser;
      });

      isNewUser = true;
    }

    // 3. 生成 JWT Token
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

    const normalizedEmail = dto.email.toLowerCase().trim();

    // 2. 查询用户
    let user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail },
      include: { tenant: true },
    });

    let authenticatedUser: {
      id: string;
      email: string | null;
      phone: string | null;
      role: UserRole;
      avatarUrl?: string | null;
    };
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
      }
      // 验证码只给租客免密登录。管理员/保洁信箱被接管不得直接拿到员工会话。
      if (user.role !== 'TENANT') {
        throw new UnauthorizedException('请使用密码登录');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      authenticatedUser = user;
    } else {
      // 首次登录，自动注册
      authenticatedUser = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            role: 'TENANT',
            isActive: true,
            lastLoginAt: new Date(),
          },
        });

        // 检查是否有管理员预创建的租客档案未绑定 userId
        const preTenant = await tx.tenant.findFirst({
          where: { email: normalizedEmail, userId: null },
        });

        if (preTenant) {
          await tx.tenant.update({
            where: { id: preTenant.id },
            data: { userId: newUser.id },
          });
        } else {
          await tx.tenant.create({
            data: {
              userId: newUser.id,
              name: normalizedEmail.split('@')[0],
              phone: `pending-${newUser.id}`,
              email: normalizedEmail,
              emergencyContact: '',
              emergencyPhone: '',
            },
          });
        }

        return newUser;
      });
      isNewUser = true;
    }

    // 3. 签发 Token
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

    await this.prisma.$transaction(async (tx) => {
      // 1. 邀请码一次性失效
      await this.inviteCodeService.consumeInviteCode(dto.inviteCode, userId, tx);

      // 2. 更新当前用户 invitedBy 关联
      if (validation.invitedBy) {
        await tx.user.update({
          where: { id: userId },
          data: { invitedBy: validation.invitedBy },
        });
      }
    });

    return {
      success: true,
      message: '邀请码兑换成功，房源身份已成功关联！',
    };
  }
}
