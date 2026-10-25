import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service.js';
import { SMS_PROVIDER } from './sms.interface.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import { AliyunSmsProvider } from './providers/aliyun-sms.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [
    SmsService,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isMock =
          config.get<string>('SMS_MOCK') === 'true' ||
          (config.get<string>('NODE_ENV') !== 'production' &&
            !config.get<string>('ALIYUN_SMS_ACCESS_KEY_ID'));

        if (isMock) {
          return new MockSmsProvider();
        }

        return new AliyunSmsProvider({
          accessKeyId: config.get<string>('ALIYUN_SMS_ACCESS_KEY_ID') || '',
          accessKeySecret:
            config.get<string>('ALIYUN_SMS_ACCESS_KEY_SECRET') || '',
          signName: config.get<string>('ALIYUN_SMS_SIGN_NAME'),
          defaultTemplateCode: config.get<string>(
            'ALIYUN_SMS_TEMPLATE_CODE_OTP',
          ),
        });
      },
    },
  ],
  exports: [SmsService, SMS_PROVIDER],
})
export class SmsModule {}
