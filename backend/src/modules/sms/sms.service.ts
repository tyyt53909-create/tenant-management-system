import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SMS_PROVIDER,
  type SendSmsOptions,
  type SendSmsResult,
  type SmsProvider,
} from './sms.interface.js';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 发送验证码短信
   */
  async sendOtp(phone: string, code: string): Promise<SendSmsResult> {
    const templateCode = this.configService.get<string>(
      'ALIYUN_SMS_TEMPLATE_CODE_OTP',
    );
    const signName = this.configService.get<string>('ALIYUN_SMS_SIGN_NAME');

    return this.provider.send({
      phone,
      templateCode,
      templateParam: { code },
      signName,
      content: `【${signName || '栖居生活'}】您的验证码为 ${code}，5分钟内有效。`,
    });
  }

  /**
   * 发送业务通知短信
   */
  async sendNotification(
    phone: string,
    content: string,
    options?: Partial<SendSmsOptions>,
  ): Promise<SendSmsResult> {
    const signName =
      options?.signName || this.configService.get<string>('ALIYUN_SMS_SIGN_NAME');

    return this.provider.send({
      phone,
      content,
      signName,
      templateCode: options?.templateCode,
      templateParam: options?.templateParam,
    });
  }

  getProviderName(): string {
    return this.provider.name;
  }
}
