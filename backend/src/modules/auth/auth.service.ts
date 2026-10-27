import { Injectable, Logger, BadRequestException, ConflictException, UnauthorizedException, ForbiddenException, Optional } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { RefreshTokenDto, RefreshTokenResponseDto } from './dto/refresh-token.dto.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { GenerateInviteCodeDto } from './dto/generate-invite-code.dto.js';
import { QueryInviteCodesDto } from './dto/query-invite-codes.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { EmailOtpService } from './email-otp.service.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { TenantCapabilityService } from '../tenant-capabilities/tenant-capability.service.js';
import { FederatedAuthService } from './federated-auth.service.js';
import { isMeterSimulatorEnabled } from '../../config/feature-flags.js';
import * as bcrypt from 'bcrypt';

const INVALID_CREDENTIALS = '邮箱/手机号或密码错误';
/** 只用于抹平「用户不存在」与「密码错误」的 bcrypt 耗时，不是任何真实账号的口令。 */
const DUMMY_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
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

      // 邀请码一次性：注册成功后立即核销（docs/03-权限矩阵.md §4.1
      // 「使用后立即失效」）。与建号同事务，避免
      // 「账号已建但邀请码仍可复用」的中间态。
      await this.inviteCodeService.consumeInviteCode(dto.inviteCode, newUser.id, tx);

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

    // 2–4. 不存在、已禁用、未设密码、密码错误都返回同一句，避免探测账号状态。
    // 禁用等原因只写日志。比较一律走 bcrypt，避免用响应时间区分用户是否存在。
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      await bcrypt.compare(dto.password, user.passwordHash || DUMMY_PASSWORD_HASH);
      this.logger.warn(`禁用账号尝试密码登录: ${user.id}`);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!user.passwordHash) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      this.logger.warn(`未设置密码的账号尝试密码登录: ${user.id}`);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
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

  async generateInviteCode(userId: string, dto?: GenerateInviteCodeDto) {
    const expiryDays = dto?.expiryDays ?? 365;
    const count = dto?.count ?? 1;
    const role = dto?.role ?? 'TENANT';
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    if (count > 1) {
      const inviteCodes = await this.inviteCodeService.generateBatchInviteCodes(
        userId,
        count,
        expiryDays,
        dto?.notes,
        role,
      );
      return {
        inviteCodes,
        count: inviteCodes.length,
        expiryDays,
        expiresAt,
        invitedBy: userId,
      };
    }

    const inviteCode = await this.inviteCodeService.generateInviteCode(
      userId,
      expiryDays,
      dto?.notes,
      role,
    );

    return {
      inviteCode,
      expiryDays,
      expiresAt,
      invitedBy: userId,
    };
  }

  async listInviteCodes(query: QueryInviteCodesDto) {
    return this.inviteCodeService.findAll(query);
  }

  async revokeInviteCode(id: string, adminUserId?: string) {
    return this.inviteCodeService.revokeInviteCode(id, adminUserId);
  }

  async refresh(dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    if (!dto.refreshToken) {
      throw new UnauthorizedException('Refresh Token 不能为空');
    }
    const refreshToken = dto.refreshToken;

    // 1. 验证 Refresh Token（仅捕获 Token 解析失败）
    let payload;
    try {
      payload = await this.jwtService.verifyToken(refreshToken);
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
    return this.jwtService.rotateRefreshToken(refreshToken);
  }

  async logout(dto: RefreshTokenDto) {
    if (dto.refreshToken) {
      await this.jwtService.revokeRefreshToken(dto.refreshToken);
    }
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
      features: {
        meterSimulator: isMeterSimulatorEnabled(),
      },
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
