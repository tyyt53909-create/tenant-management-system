import { Controller, Post, Body, Get, UseGuards, Request, BadRequestException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { RefreshTokenDto, RefreshTokenResponseDto } from './dto/refresh-token.dto.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { GenerateInviteCodeDto } from './dto/generate-invite-code.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { EmailOtpService } from './email-otp.service.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import * as bcrypt from 'bcrypt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly inviteCodeService: InviteCodeService,
    private readonly jwtService: JwtAuthService,
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailOtpService: EmailOtpService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    // 1. 验证邀请码
    const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
    if (!validation.valid) {
      throw new BadRequestException('邀请码无效');
    }

    // 2. 检查邮箱是否已注册
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('邮箱已被注册');
    }

    // 3. 检查手机号是否已注册（如果提供）
    if (dto.phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone: dto.phone },
      });
      if (existingPhone) {
        throw new ConflictException('手机号已被注册');
      }
    }

    // 4. 密码加密
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 5. 创建用户和租客（事务）
    const user = await this.prisma.$transaction(async (tx) => {
      // 创建 User
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          role: 'TENANT',
          invitedBy: validation.invitedBy,
          isActive: true,
        },
      });

      // 创建 Tenant
      // Tenant.phone 必填且唯一（docs/02-数据模型.md）：注册时手机号可选，
      // 缺失时用 userId 生成唯一占位值，避免空串触发唯一约束导致第二个注册 500（T148 / BUG-1）
      const tenantPhone = dto.phone?.trim() ? dto.phone.trim() : `pending-${newUser.id}`;

      // 邀请码一次性：注册成功后立即失效（docs/03-权限矩阵.md §4.1
      // 「使用后立即失效，48小时后自动过期」）。与建号同事务，避免
      // 「账号已建但邀请码仍可复用」的中间态。
      await tx.user.update({
        where: { id: validation.invitedBy! },
        data: { inviteCode: null, inviteExpiredAt: null },
      });

      await tx.tenant.create({
        data: {
          userId: newUser.id,
          name: dto.email.split('@')[0], // 使用邮箱前缀作为初始名称
          phone: tenantPhone,
          email: dto.email,
          emergencyContact: dto.phone || '',
          emergencyPhone: dto.phone || '',
        },
      });

      return newUser;
    });

    // 6. 生成 JWT Token
    const tokens = await this.jwtService.generateTokens({
      sub: user.id,
      role: user.role,
    });

    // 7. 返回结果
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email!,
        role: user.role,
      },
    };
  }

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    // 1. 查询用户（邮箱或手机号）
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.identifier },
          { phone: dto.identifier },
        ],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });

    // 2. 验证用户是否存在
    if (!user) {
      throw new UnauthorizedException('邮箱/手机号或密码错误');
    }

    // 3. 验证用户是否激活
    if (!user.isActive) {
      throw new ForbiddenException('账号已被禁用');
    }

    // 4. 验证密码
    if (!user.passwordHash) {
      throw new UnauthorizedException('该账号未设置密码，请使用 Google 第三方登录');
    }
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('邮箱/手机号或密码错误');
    }

    // 5. 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 6. 生成 JWT Token
    const tokens = await this.jwtService.generateTokens({
      sub: user.id,
      role: user.role,
    });

    // 7. 返回结果
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    };
  }

  /**
   * 生成邀请码（管理员专用）
   * 生产环境管理员为租客发放邀请码的唯一 HTTP 入口（T148 / BUG-2）
   */
  @Post('invite-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async generateInviteCode(@Request() req: any, @Body() dto: GenerateInviteCodeDto) {
    const expiryDays = dto?.expiryDays ?? 365;
    const inviteCode = await this.inviteCodeService.generateInviteCode(
      req.user.userId,
      expiryDays,
    );

    return {
      inviteCode,
      expiryDays,
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      invitedBy: req.user.userId,
    };
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    // 1. 验证 Refresh Token（仅捕获 Token 解析失败）
    let payload;
    try {
      payload = await this.jwtService.verifyToken(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    // 2. 查询用户
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    // 3. 验证用户是否存在
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    // 4. 验证用户是否激活
    if (!user.isActive) {
      throw new ForbiddenException('账号已被禁用');
    }

    // 5. 生成新的 Access Token
    const accessToken = await this.jwtService.refreshAccessToken(
      dto.refreshToken,
      {
        sub: user.id,
        role: user.role,
      },
    );

    // 6. 返回新的 Access Token
    return { accessToken };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Request() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        invitedBy: true,
        tenant: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            emergencyContact: true,
            emergencyPhone: true,
            contracts: {
              where: { status: 'ACTIVE' },
              select: {
                id: true,
                contractNumber: true,
                room: {
                  select: {
                    id: true,
                    roomNumber: true,
                    building: {
                      select: {
                        id: true,
                        name: true,
                        address: true,
                        metadata: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        createdAt: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }

  /**
   * 获取 Google Client ID 配置（供前端动态挂载 Google GIS SDK）
   */
  @Get('google/client-id')
  getGoogleClientId() {
    return {
      clientId: this.googleAuthService.getClientId(),
    };
  }

  /**
   * Google 登录 / 注册入口
   */
  @Post('google')
  async googleAuth(@Body() dto: GoogleAuthDto): Promise<GoogleAuthResponseDto> {
    // 1. 验证 Google idToken
    const googleUser = await this.googleAuthService.verifyIdToken(dto.idToken);

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
      role: any;
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

        if (invitedBy) {
          await tx.user.update({
            where: { id: invitedBy },
            data: { inviteCode: null, inviteExpiredAt: null },
          });
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

  /**
   * 发送邮箱验证码 (OTP)
   */
  @Post('send-email-code')
  async sendEmailCode(@Body() dto: SendEmailCodeDto) {
    const result = await this.emailOtpService.sendCode(dto.email);
    return {
      message: '验证码已发送至您的邮箱，5分钟内有效',
      cooldown: result.cooldown,
    };
  }

  /**
   * 邮箱验证码免密登录 / 自动注册
   */
  @Post('login-email-code')
  async loginWithEmailCode(@Body() dto: LoginEmailCodeDto) {
    // 1. 校验验证码
    const isValid = this.emailOtpService.verifyCode(dto.email, dto.code);
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
      role: any;
      avatarUrl?: string | null;
    };
    let isNewUser = false;

    if (user) {
      if (!user.isActive) {
        throw new ForbiddenException('账号已被禁用');
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

  /**
   * 登录后在应用内输入邀请码完成房源与身份绑定
   */
  @Post('bind-invite-code')
  @UseGuards(JwtAuthGuard)
  async bindInviteCode(@Request() req: any, @Body() dto: BindInviteCodeDto) {
    const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
    if (!validation.valid) {
      throw new BadRequestException('邀请码无效或已过期');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. 邀请码一次性失效
      await tx.user.update({
        where: { id: validation.invitedBy! },
        data: { inviteCode: null, inviteExpiredAt: null },
      });

      // 2. 更新当前用户 invitedBy 关联
      await tx.user.update({
        where: { id: req.user.userId },
        data: { invitedBy: validation.invitedBy },
      });
    });

    return {
      success: true,
      message: '邀请码兑换成功，房源身份已成功关联！',
    };
  }
}
