import type { NotificationChannel, NotificationMessage } from './notification-channel.js';

export type EmailTransport = (message: NotificationMessage) => Promise<void>;

/**
 * 邮件渠道。默认不连接 SMTP，避免在没有邮件服务时发出外部请求。
 * 测试或以后接入时注入 transport。
 */
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(private readonly transport?: EmailTransport) {}

  async send(message: NotificationMessage): Promise<void> {
    if (!message.email || !this.transport) return;
    await this.transport(message);
  }
}
