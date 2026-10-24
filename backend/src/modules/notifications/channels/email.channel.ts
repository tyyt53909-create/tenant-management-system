import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { renderNotificationTemplate } from '../templates/notification-templates.js';
import type { NotificationChannel, NotificationMessage } from './notification-channel.js';

export interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailTransport = (email: EmailContent) => Promise<void>;

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

export function parseSmtpConfiguration(env: NodeJS.ProcessEnv = process.env): SmtpConfiguration | undefined {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  if (!host || !from) return undefined;

  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD;
  if ((user && !pass) || (!user && pass)) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');

  return {
    host,
    port,
    secure: env.SMTP_SECURE === 'true' || (env.SMTP_SECURE !== 'false' && port === 465),
    ...(user && pass ? { auth: { user, pass } } : {}),
    from,
  };
}

export function createSmtpTransport(configuration: SmtpConfiguration): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    ...(configuration.auth ? { auth: configuration.auth } : {}),
  });
  return async (email) => {
    await transporter.sendMail({ from: configuration.from, ...email });
  };
}

export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly logger = new Logger(EmailChannel.name);

  constructor(private readonly transport: EmailTransport | undefined = defaultSmtpTransport()) {}

  async send(message: NotificationMessage): Promise<void> {
    if (!message.email) {
      this.logger.warn(`Skipping email notification for user ${message.userId}: recipient email is missing`);
      return;
    }
    if (!this.transport) {
      const error = new Error('SMTP is not configured; email notification cannot be delivered');
      this.logger.error(error.message);
      if (process.env.NODE_ENV === 'production') throw error;
      return;
    }
    const templateKey = typeof message.data?.template === 'string' ? message.data.template : undefined;
    const rendered = renderNotificationTemplate(templateKey, message);
    await this.transport({ to: message.email, subject: message.title, ...rendered });
  }
}

function defaultSmtpTransport(): EmailTransport | undefined {
  const configuration = parseSmtpConfiguration();
  return configuration ? createSmtpTransport(configuration) : undefined;
}
