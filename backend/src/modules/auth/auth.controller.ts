import { Controller, Post, Body, Get, Delete, Param, Query, UseGuards, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { RefreshTokenDto, RefreshTokenResponseDto } from './dto/refresh-token.dto.js';
import { GenerateInviteCodeDto } from './dto/generate-invite-code.dto.js';
import { QueryInviteCodesDto } from './dto/query-invite-codes.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { AuthThrottle, OtpEmailThrottle } from '../../common/decorators/throttle.decorators.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  extractRefreshToken,
} from './auth-cookie.util.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /** refresh token Cookie 的 Secure 标志由配置层决定（生产环境必须为 true） */
  private get secureCookies(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Post('register')
  @AuthThrottle()
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<RegisterResponseDto> {
    const result = await this.authService.register(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies);
    }
    return result;
  }

  @Post('login')
  @AuthThrottle()
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies);
    }
    return result;
  }

  /**
   * 生成邀请码（管理员专用）
   * 生产环境管理员为租客发放邀请码的唯一 HTTP 入口（T148 / BUG-2）
   */
  @Post('invite-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async generateInviteCode(@CurrentUser() userParam: CurrentUserParam, @Body() dto: GenerateInviteCodeDto) {
    const user = resolveAuthUser(userParam);
    return this.authService.generateInviteCode(user.userId, dto);
  }

  /**
   * 查询邀请码列表（管理员专用）
   */
  @Get('invite-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async listInviteCodes(@Query() query: QueryInviteCodesDto) {
    return this.authService.listInviteCodes(query);
  }

  /**
   * 作废邀请码（管理员专用）
   */
  @Delete('invite-codes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async revokeInviteCode(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.authService.revokeInviteCode(id, user.userId);
  }

  @Post('refresh')
  async refresh(
    @Body() dto?: RefreshTokenDto,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<RefreshTokenResponseDto> {
    const token = extractRefreshToken(req, dto?.refreshToken);
    if (!token) {
      throw new UnauthorizedException('Refresh Token 不能为空');
    }
    const result = await this.authService.refresh({ refreshToken: token });
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies);
    }
    return result;
  }

  @Post('logout')
  async logout(
    @Body() dto?: RefreshTokenDto,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const token = extractRefreshToken(req, dto?.refreshToken);
    if (token) {
      await this.authService.logout({ refreshToken: token });
    }
    if (res) {
      clearRefreshTokenCookie(res, this.secureCookies);
    }
    return { message: '已登出' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser() userParam: CurrentUserParam,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const user = resolveAuthUser(userParam);
    const result = await this.authService.logoutAll(user.userId);
    if (res) {
      clearRefreshTokenCookie(res, this.secureCookies);
    }
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.authService.getMe(user.userId);
  }

  /**
   * 获取 Google Client ID 配置（供前端动态挂载 Google GIS SDK）
   */
  @Get('google/client-id')
  getGoogleClientId() {
    return this.authService.getGoogleClientId();
  }

  /**
   * Google 登录 / 注册入口
   */
  @Post('google')
  @AuthThrottle()
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<GoogleAuthResponseDto> {
    const result = await this.authService.googleAuth(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies);
    }
    return result;
  }

  /**
   * 发送邮箱验证码 (OTP)
   */
  @Post('send-email-code')
  @OtpEmailThrottle()
  async sendEmailCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendEmailCode(dto);
  }

  /**
   * 邮箱验证码免密登录 / 自动注册
   */
  @Post('login-email-code')
  @AuthThrottle()
  async loginWithEmailCode(
    @Body() dto: LoginEmailCodeDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.authService.loginWithEmailCode(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies);
    }
    return result;
  }

  /**
   * 登录后在应用内输入邀请码完成房源与身份绑定
   */
  @Post('bind-invite-code')
  @AuthThrottle()
  @UseGuards(JwtAuthGuard)
  async bindInviteCode(@CurrentUser() userParam: CurrentUserParam, @Body() dto: BindInviteCodeDto) {
    const user = resolveAuthUser(userParam);
    return this.authService.bindInviteCode(user.userId, dto);
  }
}
