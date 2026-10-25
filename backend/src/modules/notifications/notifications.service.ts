import { Injectable, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { QueryNotificationsDto } from './dto/query-notifications.dto.js';
import { NotificationDispatcher } from './channels/notification-dispatcher.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { NotificationsGateway } from './notifications.gateway.js';

@Injectable()
export class NotificationsService {
  /**
   * 渠道调度器由容器注入（QLT-02 / T288）。
   * 之前 `?? NotificationDispatcher.createDefault(prisma)` 会在模块漏注册时
   * 现场 new 一套渠道，导致测试替身失效、也无法在部署时替换渠道实现。
   * `NotificationsGateway` 仍可缺省：Worker / 单测进程里没有 WebSocket server。
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
    @Optional() private readonly gateway?: NotificationsGateway,
  ) {}

  async create(dto: CreateNotificationDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('接收用户不存在');

    const notification = await this.dispatcher.dispatch({
      userId: dto.userId,
      email: user.email,
      title: dto.title,
      body: dto.body,
      priority: dto.priority ?? 'NORMAL',
      data: dto.data,
      expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : undefined,
      dedupKey: dto.dedupKey,
    });
    // 站内通知落库后实时推送；WS 未连接时客户端轮询未读数兜底
    if (notification && typeof notification === 'object' && 'id' in notification) {
      this.gateway?.emitNotification(dto.userId, notification);
    }
    return notification;
  }

  async findAll(userId: string, query: QueryNotificationsDto) {
    const { page = 1, limit = 20, unreadOnly,readState,q } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = scopedWhere(userId, {}, 'userId');
    if (unreadOnly) where.isRead = false;
    if(readState)where.isRead=readState==='READ';
    if(q?.trim())where.OR=[{title:{contains:q.trim(),mode:'insensitive'}},{body:{contains:q.trim(),mode:'insensitive'}}];

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where: where as never }),
      this.prisma.notification.count({ where: scopedWhere(userId, { isRead: false }, 'userId') }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), unreadCount },
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: scopedWhere(userId, { isRead: false }, 'userId'),
    });
    return { unreadCount: count };
  }

  async markRead(id: string, userId: string) {
    const scope = scopedWhere(userId, {}, 'userId');
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('通知不存在');
    if (notification.userId !== scope.userId) throw new ForbiddenException('无权操作他人通知');

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: scopedWhere(userId, { isRead: false }, 'userId'),
      data: { isRead: true, readAt: new Date() },
    });
    return { message: '已全部标记已读', count: result.count };
  }

  async remove(id: string, userId: string) {
    const scope = scopedWhere(userId, {}, 'userId');
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('通知不存在');
    if (notification.userId !== scope.userId) throw new ForbiddenException('无权删除他人通知');

    await this.prisma.notification.delete({ where: { id } });
    return { message: '通知已删除' };
  }
}
