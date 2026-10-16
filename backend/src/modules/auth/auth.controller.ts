import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { RegisterDto, RegisterResponseDto } from './dto/register.dto.js';
import { LoginDto, LoginResponseDto } from './dto/login.dto.js';
import { RefreshTokenDto, RefreshTokenResponseDto } from './dto/refresh-token.dto.js';
import { GenerateInviteCodeDto } from './dto/generate-invite-code.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { GoogleAuthDto, GoogleAuthResponseDto } from './dto/google-auth.dto.js';
import { SendEmailCodeDto, LoginEmailCodeDto, BindInviteCodeDto } from './dto/email-otp.dto.js';
import { AuthThrottle, OtpEmailThrottle } from '../../common/decorators/throttle.decorators.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @AuthThrottle()
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @AuthThrottle()
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
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

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.authService.logoutAll(user.userId);
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
  async googleAuth(@Body() dto: GoogleAuthDto): Promise<GoogleAuthResponseDto> {
    return this.authService.googleAuth(dto);
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
  async loginWithEmailCode(@Body() dto: LoginEmailCodeDto) {
    return this.authService.loginWithEmailCode(dto);
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
