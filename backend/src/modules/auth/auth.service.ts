import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
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
import { resolveLoginProtection, type LoginProtection } from '../../config/password.config.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { claimPreCreatedTenant } from './pre-created-tenant.js';
import { decideInviteClaim } from './claim-invite.js';
import {
  LOGIN_ATTEMPT_STORE,
  MemoryLoginAttemptStore,
  type LoginAttemptStore,
} from './login-attempt.store.js';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto.js';
import { resolveBcryptRounds } from '../../config/password.config.js';

@Injectable()
export class AuthService {
  private dummyPasswordHash: string | null = null;

  constructor(
    private readonly inviteCodeService: InviteCodeService,
    private readonly jwtService: JwtAuthService,
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailOtpService: EmailOtpService,
    private readonly tenantCapabilityService: TenantCapabilityService,
    private readonly configService: ConfigService,
    @Inject(LOGIN_ATTEMPT_STORE) private readonly loginAttemptStore: LoginAttemptStore,
    private readonly federatedAuthService: FederatedAuthService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    const email = dto.email.toLowerCase().trim();
    const phone = dto.phone?.trim() || undefined;

    if (!dto.emailCode?.trim()) {
      throw apiError(ErrorCode.AUTH_EMAIL_UNVERIFIED);
    }
    const emailVerified = await this.emailOtpService.verifyCode(email, dto.emailCode);
    if (!emailVerified) {
      throw apiError(ErrorCode.AUTH_EMAIL_UNVERIFIED, '邮箱验证码错误或已过期');
    }

    // 1. 验证邀请码。验证码已在 Redis 中核销，不能并入下面的数据库事务。
    const validation = await this.inviteCodeService.validateInviteCode(dto.inviteCode);
    if (!validation.valid) {
      throw apiError(ErrorCode.AUTH_CLAIM_REVERIFY, '邀请码无效，验证码已失效，请重新验证');
    }

    // 2. 检查邮箱是否已注册
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException('邮箱已被注册');
    }

    // 3. 检查手机号是否已注册（如果提供）
    if (phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (existingPhone) {
        throw new ConflictException('手机号已被注册');
      }
    }

    const invitedTenant = validation.tenantId
      ? await this.prisma.tenant.findUnique({
          where: { id: validation.tenantId },
          select: { id: true, email: true, phone: true, userId: true },
        })
      : null;
    const claim = decideInviteClaim({
      invite: validation,
      verifiedEmail: email,
      suppliedPhone: phone,
      tenant: invitedTenant,
    });

    // 5. 密码加密（cost 可配置，默认 12；旧 cost 10 哈希仍可验证）
    const passwordHash = await bcrypt.hash(dto.password, this.loginProtection().bcryptRounds);

    // 6. 创建用户并绑定预建租客（事务，不新建 Tenant）
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            phone: claim.kind === 'tenant' ? phone : undefined,
            passwordHash,
            role: claim.kind === 'staff' ? claim.role : 'TENANT',
            invitedBy: validation.invitedBy ?? null,
            isActive: true,
            emailVerifiedAt: new Date(),
          },
        });

        await tx.userIdentity.create({
          data: {
            userId: newUser.id,
            provider: 'EMAIL',
            providerUserId: email,
            email,
            emailVerifiedAt: new Date(),
          },
        });

        if (claim.kind === 'tenant') {
          await claimPreCreatedTenant(tx, claim.tenantId, newUser.id);
        }

        await this.inviteCodeService.consumeInviteCode(dto.inviteCode, newUser.id, tx);
        return newUser;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw apiError(ErrorCode.AUTH_CLAIM_REVERIFY);
    }

    // 7. 生成 JWT Token
    const tokens = await this.jwtService.generateTokens({
      sub: user.id,
      role: user.role,
    });

    // 8. 返回结果
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
    const identifier = dto.identifier.trim();
    const protection = this.loginProtection();

    // 1. 锁定检查先于数据库查询：锁定期间不触库，也不泄露账号是否存在
    if ((await this.loginAttemptStore.getFailures(identifier)) >= protection.maxFailedAttempts) {
      throw this.loginLockedException();
    }

    // 2. 查询用户（邮箱或手机号）
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { phone: identifier },
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

    // 3. 未知账号也执行一次 dummy 比对，避免响应耗时泄露账号是否存在
    if (!user || !user.passwordHash) {
      await this.compareAgainstDummy(dto.password, protection.bcryptRounds);
      await this.registerLoginFailure(identifier, protection);
      throw this.invalidCredentialsException();
    }

    // 4. 验证密码（先验密码再判断禁用，避免未持有密码者枚举账号状态）
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.registerLoginFailure(identifier, protection);
      throw this.invalidCredentialsException();
    }

    if (!user.isActive) {
      throw new ForbiddenException('账号已被禁用');
    }

    // 5. 登录成功清零失败计数
    await this.loginAttemptStore.clear(identifier);

    // 6. 更新最后登录时间
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 7. 生成 JWT Token
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
        dto?.tenantId,
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
      dto?.tenantId,
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

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
    if (!user?.passwordHash || !(await bcrypt.compare(dto.oldPassword, user.passwordHash))) {
      throw new UnauthorizedException('当前密码不正确');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, resolveBcryptRounds(this.configService.get<string>('BCRYPT_ROUNDS')));
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.jwtService.revokeUserSessions(userId);
    return { message: '密码已修改' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      try { await this.emailOtpService.sendCode(email); } catch { /* 对外不泄漏账户或邮件投递状态 */ }
    }
    return { message: '若邮箱对应有效账号，验证码将发送至该邮箱' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const valid = await this.emailOtpService.verifyCode(email, dto.code);
    if (!valid) throw new BadRequestException('验证码无效或已过期');
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new BadRequestException('验证码无效或已过期');
    const passwordHash = await bcrypt.hash(dto.newPassword, resolveBcryptRounds(this.configService.get<string>('BCRYPT_ROUNDS')));
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.jwtService.revokeUserSessions(user.id);
    return { message: '密码已重置' };
  }

  private loginProtection(): LoginProtection {
    return resolveLoginProtection({
      LOGIN_MAX_FAILED_ATTEMPTS: this.configService.get<string>('LOGIN_MAX_FAILED_ATTEMPTS'),
      LOGIN_LOCK_MS: this.configService.get<string>('LOGIN_LOCK_MS'),
      BCRYPT_ROUNDS: this.configService.get<string>('BCRYPT_ROUNDS'),
    });
  }

  /** 记录一次失败；达到阈值时本次直接返回 429。 */
  private async registerLoginFailure(
    identifier: string,
    protection: LoginProtection,
  ): Promise<void> {
    const failures = await this.loginAttemptStore.registerFailure(identifier, protection.lockMs);
    if (failures >= protection.maxFailedAttempts) {
      throw this.loginLockedException();
    }
  }

  /**
   * 未知账号/无密码账号的等时比对。
   * dummy 哈希在首次使用时按当前 cost 生成并缓存，避免硬编码哈希或每次请求都重新计算。
   */
  private async compareAgainstDummy(password: string, rounds: number): Promise<void> {
    if (!this.dummyPasswordHash) {
      this.dummyPasswordHash = await bcrypt.hash(randomBytes(16).toString('hex'), rounds);
    }
    await bcrypt.compare(password, this.dummyPasswordHash);
  }

  private invalidCredentialsException(): UnauthorizedException {
    return new UnauthorizedException('邮箱/手机号或密码错误');
  }

  private loginLockedException(): HttpException {
    return new HttpException('登录尝试次数过多，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }
}
