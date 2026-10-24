import { describe, expect, it, vi } from 'vitest';
import { EmailChannel, parseSmtpConfiguration } from './email.channel.js';
import type { NotificationMessage } from './notification-channel.js';
import { renderNotificationTemplate } from '../templates/notification-templates.js';

const message: NotificationMessage = {
  userId: 'user-1',
  email: 'tenant@example.com',
  title: '账单提醒 <script>',
  body: '请及时缴费\n谢谢',
  priority: 'URGENT',
  data: { template: 'RENT_BILL' },
};

describe('notification email templates', () => {
  it('renders text and escaped HTML', () => {
    const result = renderNotificationTemplate('RENT_BILL', message);
    expect(result.text).toContain('租金账单提醒');
    expect(result.text).toContain('请及时缴费\n谢谢');
    expect(result.html).toContain('账单提醒 &lt;script&gt;');
    expect(result.html).toContain('<br>谢谢');
  });

  it('falls back to GENERIC for unknown template keys', () => {
    expect(renderNotificationTemplate('NOT_REGISTERED', message).text).toContain('通知提醒');
  });
});

describe('EmailChannel', () => {
  it('does not send without a transport outside production', async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      await expect(new EmailChannel(undefined).send(message)).resolves.toBeUndefined();
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  it('fails closed in production when SMTP is not configured', async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(new EmailChannel(undefined).send(message)).rejects.toThrow('SMTP is not configured');
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });

  it('throws when transport fails and provides rendered email content', async () => {
    const transport = vi.fn(async () => { throw new Error('delivery failed'); });
    await expect(new EmailChannel(transport).send(message)).rejects.toThrow('delivery failed');
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      to: 'tenant@example.com',
      subject: message.title,
      text: expect.stringContaining('租金账单提醒'),
      html: expect.stringContaining('<main>'),
    }));
  });

  it('parses SMTP settings and rejects invalid port/partial authentication', () => {
    expect(parseSmtpConfiguration({ SMTP_HOST: 'mail.example.com', SMTP_FROM: 'noreply@example.com' } as NodeJS.ProcessEnv))
      .toMatchObject({ host: 'mail.example.com', port: 465, secure: true, from: 'noreply@example.com' });
    expect(parseSmtpConfiguration({ SMTP_HOST: 'mail.example.com', SMTP_FROM: 'noreply@example.com', SMTP_PORT: '465' } as NodeJS.ProcessEnv))
      .toMatchObject({ port: 465, secure: true });
    expect(() => parseSmtpConfiguration({ SMTP_HOST: 'mail.example.com', SMTP_FROM: 'noreply@example.com', SMTP_PORT: 'bad' } as NodeJS.ProcessEnv))
      .toThrow('SMTP_PORT');
    expect(() => parseSmtpConfiguration({ SMTP_HOST: 'mail.example.com', SMTP_FROM: 'noreply@example.com', SMTP_USER: 'user' } as NodeJS.ProcessEnv))
      .toThrow('SMTP_USER and SMTP_PASS');
  });
});
