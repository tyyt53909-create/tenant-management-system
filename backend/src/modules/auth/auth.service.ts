import { Injectable, BadRequestException, ConflictException, UnauthorizedException, ForbiddenException, Optional } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { RefreshTokenDto, RefreshTokenResponseDto } from './dto/refresh-token.dto.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { GenerateInviteCodeDto } from './dto/generate-invite-code.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { EmailOtpService } from './email-otp.service.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { TenantCapabilityService } from '../tenant-capabilities/tenant-capability.service.js';
import { FederatedAuthService } from './federated-auth.service.js';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly federatedAuthService: FederatedAuthService;

  constructor(
    private readonly inviteCodeService: InviteCodeService,
    private readonly jwtService: JwtAuthService,
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailOtpService: EmailOtpService,
    private readonly tenantCapabilityService: TenantCapabilityService,
    @Optional() federatedAuthService?: FederatedAuthService,
  ) {
    this.federatedAuthService =
      federatedAuthService ??
      new FederatedAuthService(
        prisma,
        googleAuthService,
        emailOtpService,
        jwtService,
        inviteCodeService,
      );
  }

  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
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

  async login(dto: LoginDto): Promise<LoginResponseDto> {
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

  async generateInviteCode(userId: string, dto: GenerateInviteCodeDto) {
    const expiryDays = dto?.expiryDays ?? 365;
    const inviteCode = await this.inviteCodeService.generateInviteCode(
      userId,
      expiryDays,
    );

    return {
      inviteCode,
      expiryDays,
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      invitedBy: userId,
    };
  }

  async refresh(dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    // 1. 验证 Refresh Token（仅捕获 Token 解析失败）
    let payload;
    try {
      payload = await this.jwtService.verifyToken(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    if (payload.tokenType !== 'REFRESH') {
      throw new UnauthorizedException('Token 用途不匹配，请提供 Refresh Token');
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

    // 5. 轮换 Refresh Token，并签发新的 Access Token
    return this.jwtService.rotateRefreshToken(dto.refreshToken);
  }

  async logout(dto: RefreshTokenDto) {
    await this.jwtService.revokeRefreshToken(dto.refreshToken);
    return { message: '已登出' };
  }

  async logoutAll(userId: string) {
    await this.jwtService.revokeUserSessions(userId);
    return { message: '已登出所有设备' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    const capabilities =
      user.role === 'TENANT'
        ? await this.tenantCapabilityService.getEffectiveCapabilities(user.id)
        : [];

    return {
      ...user,
      capabilities,
    };
  }

  getGoogleClientId() {
    return this.federatedAuthService.getGoogleClientId();
  }

  async googleAuth(dto: GoogleAuthDto): Promise<GoogleAuthResponseDto> {
    return this.federatedAuthService.googleAuth(dto);
  }

  async sendEmailCode(dto: SendEmailCodeDto) {
    return this.federatedAuthService.sendEmailCode(dto);
  }

  async loginWithEmailCode(dto: LoginEmailCodeDto) {
    return this.federatedAuthService.loginWithEmailCode(dto);
  }

  async bindInviteCode(userId: string, dto: BindInviteCodeDto) {
    return this.federatedAuthService.bindInviteCode(userId, dto);
  }
}
