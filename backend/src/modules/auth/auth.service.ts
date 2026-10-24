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
import {
  LOGIN_ATTEMPT_STORE,
  MemoryLoginAttemptStore,
  type LoginAttemptStore,
} from './login-attempt.store.js';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly federatedAuthService: FederatedAuthService;
  private readonly loginAttemptStore: LoginAttemptStore;
  private dummyPasswordHash: string | null = null;

  constructor(
    private readonly inviteCodeService: InviteCodeService,
    private readonly jwtService: JwtAuthService,
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly emailOtpService: EmailOtpService,
    private readonly tenantCapabilityService: TenantCapabilityService,
    private readonly configService: ConfigService,
    @Optional() @Inject(LOGIN_ATTEMPT_STORE) loginAttemptStore?: LoginAttemptStore,
    @Optional() federatedAuthService?: FederatedAuthService,
  ) {
    this.loginAttemptStore = loginAttemptStore ?? new MemoryLoginAttemptStore();
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

    // 4. 密码加密（cost 可配置，默认 12；旧 cost 10 哈希仍可验证）
    const passwordHash = await bcrypt.hash(dto.password, this.loginProtection().bcryptRounds);

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
