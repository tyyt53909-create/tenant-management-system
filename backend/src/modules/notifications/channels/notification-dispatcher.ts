import { InAppChannel } from './in-app.channel.js';
import { EmailChannel } from './email.channel.js';
import type { NotificationChannel, NotificationMessage } from './notification-channel.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export class NotificationDispatcher {
  constructor(private readonly channels: NotificationChannel[]) {}

  static createDefault(prisma: PrismaService): NotificationDispatcher {
    return new NotificationDispatcher([new InAppChannel(prisma), new EmailChannel()]);
  }

  /** 显式点名渠道；否则普通通知只走站内，紧急通知再加邮件。 */
  select(message: NotificationMessage): NotificationChannel[] {
    if (message.channels?.length) {
      const chosen = this.channels.filter((channel) => message.channels!.includes(channel.name));
      if (chosen.length === 0) {
        throw new Error(`没有匹配的通知渠道：${message.channels.join(',')}`);
      }
      return chosen;
    }
    return this.channels.filter((channel) =>
      channel.name === 'in-app' || (message.priority === 'URGENT' && channel.name === 'email'),
    );
  }

  async dispatch(message: NotificationMessage): Promise<unknown> {
    let inAppResult: unknown;
    for (const channel of this.select(message)) {
      const result = await channel.send(message);
      if (channel.name === 'in-app') inAppResult = result;
    }
    return inAppResult;
  }
}
