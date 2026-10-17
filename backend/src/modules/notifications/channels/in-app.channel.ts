import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isUniqueConstraintError } from '../../../common/utils/prisma-error.js';
import type { NotificationChannel, NotificationMessage } from './notification-channel.js';

/** 站内通知。全库只有这里写入 notification 表。 */
export class InAppChannel implements NotificationChannel {
  readonly name = 'in-app';

  constructor(private readonly prisma: PrismaService) {}

  async send(message: NotificationMessage) {
    const dedupKey = message.dedupKey?.trim() || null;
    try {
      return await this.prisma.notification.create({
        data: {
          userId: message.userId,
          title: message.title,
          body: message.body,
          priority: message.priority,
          data: message.data as Prisma.InputJsonValue | undefined,
          expiredAt: message.expiredAt,
          dedupKey,
        },
      });
    } catch (error) {
      if (!dedupKey || !isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await this.prisma.notification.findUnique({ where: { dedupKey } });
      if (!existing) {
        throw error;
      }
      return existing;
    }
  }
}
