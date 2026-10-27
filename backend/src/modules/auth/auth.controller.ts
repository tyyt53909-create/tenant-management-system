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
import { Public } from '../../common/decorators/public.decorator.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { WechatLoginDto, WechatBindDto } from './dto/wechat-auth.dto.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { SendSmsCodeDto, LoginSmsCodeDto, BindPhoneSmsDto } from './dto/sms-otp.dto.js';
import { AuthThrottle, OtpEmailThrottle } from '../../common/decorators/throttle.decorators.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import {
  DEFAULT_REFRESH_TOKEN_MAX_AGE_MS,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  extractRefreshToken,
  stripRefreshTokenForBrowser,
} from './auth-cookie.util.js';
import { durationMsOr } from '../../common/utils/duration.js';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto.js';

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

  /** Cookie 生命周期与 JWT_REFRESH_EXPIRY 对齐，避免 Cookie 与 Token 过期时间错位（T258）。 */
  private get refreshCookieMaxAgeMs(): number {
    return durationMsOr(
      this.configService.get<string>('jwt.refreshTokenExpiry'),
      DEFAULT_REFRESH_TOKEN_MAX_AGE_MS,
    );
  }

  @Post('register')
  @Public()
  @AuthThrottle()
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res?: Response,
    @Req() req?: Request,
  ): Promise<RegisterResponseDto> {
    const result = await this.authService.register(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return stripRefreshTokenForBrowser(result, req);
  }

  @Post('login')
  @Public()
  @AuthThrottle()
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res?: Response,
    @Req() req?: Request,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return stripRefreshTokenForBrowser(result, req);
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
  @Public()
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
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return stripRefreshTokenForBrowser(result, req);
  }

  @Post('logout')
  @Public()
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
  @Public()
  getGoogleClientId() {
    return this.authService.getGoogleClientId();
  }

  /**
   * Google 登录 / 注册入口
   */
  @Post('google')
  @Public()
  @AuthThrottle()
  async googleAuth(
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res?: Response,
    @Req() req?: Request,
  ): Promise<GoogleAuthResponseDto> {
    const result = await this.authService.googleAuth(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return stripRefreshTokenForBrowser(result, req);
  }

  /**
   * 获取微信小程序 AppID 配置
   */
  @Get('wechat/config')
  @Public()
  getWechatConfig() {
    return this.authService.getWechatConfig();
  }

  /**
   * 微信一键登录
   */
  @Post('wechat/login')
  @Public()
  @AuthThrottle()
  async wechatLogin(
    @Body() dto: WechatLoginDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.authService.wechatLogin(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return result;
  }

  /**
   * 微信账号绑定预建租客身份
   */
  @Post('wechat/bind')
  @Public()
  @AuthThrottle()
  async wechatBind(
    @Body() dto: WechatBindDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.authService.wechatBind(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return result;
  }

  /**
   * 发送邮箱验证码 (OTP)
   */
  @Post('send-email-code')
  @Public()
  @OtpEmailThrottle()
  async sendEmailCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendEmailCode(dto);
  }

  /**
   * 发送手机短信验证码 (OTP)
   */
  @Post('send-sms-code')
  @Public()
  @OtpEmailThrottle()
  async sendSmsCode(@Body() dto: SendSmsCodeDto) {
    return this.authService.sendSmsCode(dto);
  }

  /**
   * 邮箱验证码免密登录 / 自动注册
   */
  @Post('login-email-code')
  @Public()
  @AuthThrottle()
  async loginWithEmailCode(
    @Body() dto: LoginEmailCodeDto,
    @Res({ passthrough: true }) res?: Response,
    @Req() req?: Request,
  ) {
    const result = await this.authService.loginWithEmailCode(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return stripRefreshTokenForBrowser(result, req);
  }

  /**
   * 手机短信验证码免密登录 / 自动注册
   */
  @Post('login-sms-code')
  @Public()
  @AuthThrottle()
  async loginWithSmsCode(
    @Body() dto: LoginSmsCodeDto,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.authService.loginWithSmsCode(dto);
    if (res && result?.refreshToken) {
      setRefreshTokenCookie(res, result.refreshToken, this.secureCookies, this.refreshCookieMaxAgeMs);
    }
    return result;
  }

  /**
   * 登录用户通过短信验证码绑定手机号
   */
  @Post('bind-phone-sms')
  @UseGuards(JwtAuthGuard)
  async bindPhoneSms(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: BindPhoneSmsDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.authService.bindPhoneSms(user.userId, dto);
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

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() current: CurrentUserParam, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(resolveAuthUser(current).userId, dto);
  }

  @Post('password/forgot')
  @Public()
  @AuthThrottle()
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('password/reset')
  @Public()
  @AuthThrottle()
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
