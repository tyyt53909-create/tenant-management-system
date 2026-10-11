import { Controller, Post, Body, BadRequestException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly inviteCodeService: InviteCodeService,
    private readonly jwtService: JwtAuthService,
    private readonly prisma: PrismaService,
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
      await tx.tenant.create({
        data: {
          userId: newUser.id,
          name: dto.email.split('@')[0], // 使用邮箱前缀作为初始名称
          phone: dto.phone || '',
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
}
