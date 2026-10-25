import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type { SendSmsOptions, SendSmsResult, SmsProvider } from '../sms.interface.js';

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName?: string;
  defaultTemplateCode?: string;
}

export class AliyunSmsProvider implements SmsProvider {
  readonly name = 'aliyun';
  private readonly logger = new Logger(AliyunSmsProvider.name);

  constructor(private readonly config: AliyunSmsConfig) {}

  async send(options: SendSmsOptions): Promise<SendSmsResult> {
    const { phone, templateCode, templateParam, signName } = options;
    const finalSignName = signName || this.config.signName || '栖居生活';
    const finalTemplateCode =
      templateCode || this.config.defaultTemplateCode || '';

    if (!this.config.accessKeyId || !this.config.accessKeySecret) {
      this.logger.error('阿里云短信未配置 AccessKeyId 或 AccessKeySecret');
      return {
        success: false,
        code: 'MISSING_CREDENTIALS',
        message: '阿里云短信凭证未配置',
      };
    }

    const params: Record<string, string> = {
      AccessKeyId: this.config.accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: 'cn-hangzhou',
      SignName: finalSignName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomUUID(),
      SignatureVersion: '1.0',
      TemplateCode: finalTemplateCode,
      Timestamp: new Date().toISOString().replace(/\.\d{3}/, ''),
      Version: '2017-05-25',
    };

    if (templateParam) {
      params.TemplateParam = JSON.stringify(templateParam);
    }

    const signature = this.computeSignature(
      'POST',
      params,
      this.config.accessKeySecret,
    );
    params.Signature = signature;

    const bodyString = new URLSearchParams(params).toString();
    try {
      const response = await fetch('https://dysmsapi.aliyuncs.com/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyString,
      });

      const data = (await response.json()) as any;
      if (data && data.Code === 'OK') {
        return {
          success: true,
          messageId: data.BizId || data.RequestId,
          code: data.Code,
          message: data.Message || 'OK',
        };
      }

      this.logger.error(
        `阿里云短信发送失败: Code=${data?.Code}, Message=${data?.Message}`,
      );
      return {
        success: false,
        code: data?.Code || 'FAILED',
        message: data?.Message || '短信发送失败',
      };
    } catch (err: any) {
      this.logger.error(`请求阿里云短信服务发生网络异常: ${err.message}`);
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: err.message,
      };
    }
  }

  private computeSignature(
    method: string,
    params: Record<string, string>,
    accessKeySecret: string,
  ): string {
    const sortedKeys = Object.keys(params).sort();
    const canonicalizedQuery = sortedKeys
      .map(
        (key) =>
          `${this.specialUrlEncode(key)}=${this.specialUrlEncode(params[key])}`,
      )
      .join('&');

    const stringToSign = `${method}&${this.specialUrlEncode('/')}&${this.specialUrlEncode(canonicalizedQuery)}`;
    return createHmac('sha1', `${accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');
  }

  private specialUrlEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/%7E/g, '~');
  }
}
