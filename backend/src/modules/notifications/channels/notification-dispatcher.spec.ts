import { describe, expect, it, vi } from 'vitest';
import { EmailChannel } from './email.channel.js';
import { InAppChannel } from './in-app.channel.js';
import type { NotificationChannel, NotificationMessage } from './notification-channel.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

class RecordingChannel implements NotificationChannel {
  readonly name = 'audit';
  readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage) {
    this.sent.push(message);
    return { recorded: true };
  }
}

describe('NotificationDispatcher', () => {
  const message = {
    userId: 'user-1',
    email: 'tenant@example.com',
    title: '收租提醒',
    body: '租金将到期',
    priority: 'NORMAL' as const,
  };

  it('普通通知只写站内，不碰其他渠道', async () => {
    const prisma = { notification: { create: vi.fn().mockResolvedValue({ id: 'n-1' }) } };
    const audit = new RecordingChannel();
    const dispatcher = new NotificationDispatcher([
      new InAppChannel(prisma as never),
      new EmailChannel(async () => { throw new Error('不应发信'); }),
      audit,
    ]);

    await expect(dispatcher.dispatch(message)).resolves.toEqual({ id: 'n-1' });
    expect(prisma.notification.create).toHaveBeenCalledOnce();
    expect(audit.sent).toHaveLength(0);
  });

  it('新增渠道只要注册并在消息里点名，不必改调度器', async () => {
    const audit = new RecordingChannel();
    const dispatcher = new NotificationDispatcher([audit]);

    await dispatcher.dispatch({ ...message, channels: ['audit'] });

    expect(audit.sent).toEqual([expect.objectContaining({ title: '收租提醒', channels: ['audit'] })]);
  });

  it('紧急通知会把邮件渠道也叫上', async () => {
    const sent: string[] = [];
    const dispatcher = new NotificationDispatcher([
      new EmailChannel(async (item) => { sent.push(item.email || ''); }),
    ]);

    await dispatcher.dispatch({ ...message, priority: 'URGENT' });

    expect(sent).toEqual(['tenant@example.com']);
  });
});
