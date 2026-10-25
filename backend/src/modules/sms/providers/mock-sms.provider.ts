import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SendSmsOptions, SendSmsResult, SmsProvider } from '../sms.interface.js';

export interface MockSmsRecord extends SendSmsOptions {
  messageId: string;
  sentAt: number;
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockSmsProvider.name);
  private sentRecords: MockSmsRecord[] = [];

  async send(options: SendSmsOptions): Promise<SendSmsResult> {
    const messageId = `mock_sms_${randomUUID()}`;
    const record: MockSmsRecord = {
      ...options,
      messageId,
      sentAt: Date.now(),
    };
    this.sentRecords.push(record);

    const paramStr = options.templateParam
      ? JSON.stringify(options.templateParam)
      : options.content || '';
    this.logger.log(
      `[MOCK SMS] 📱 发送短信至 ${options.phone} (模板=${options.templateCode || 'default'}, 参数=${paramStr}, 消息ID=${messageId})`,
    );

    return {
      success: true,
      messageId,
      code: 'OK',
      message: '发送成功（模拟）',
    };
  }

  getSentRecords(): MockSmsRecord[] {
    return [...this.sentRecords];
  }

  getLatestRecord(phone?: string): MockSmsRecord | undefined {
    if (!phone) return this.sentRecords[this.sentRecords.length - 1];
    const filtered = this.sentRecords.filter((r) => r.phone === phone);
    return filtered[filtered.length - 1];
  }

  clear(): void {
    this.sentRecords = [];
  }
}
