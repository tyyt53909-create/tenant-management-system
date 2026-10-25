import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Announcement, AnnouncementAudience, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto.js';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto.js';
import { announcementDedupKey, validateAudience } from './announcement-audience.js';

export interface AnnouncementRecipient {
  userId: string;
  tenantId: string;
}

export interface PublishResult {
  announcement: Announcement;
  recipients: number;
  failed: number;
  errors: string[];
}

/**
 * 公告与定向消息（COM-04 / T284）。
 *
 * 公告不直接写通知表：发布时按目标解析出接收用户，再复用通知中心
 * （`NotificationsService` → 站内通知 + WebSocket 推送）。因此：
 * - 受众解析只有一处逻辑，站内信/实时推送自动一致；
 * - 去重键 `ANNOUNCEMENT:{id}:{userId}` 让重发幂等，不会给同一人发第二次；
 * - 发布过程不包在数据库事务里（通知投递可能触发外部渠道）。
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  /**
   * 通知服务必填（QLT-02 / T288）：公告的唯一投递路径就是通知中心。
   * 之前允许缺省再在 publish 时抛 409「通知服务不可用」——那是装配错误，
   * 应该在启动时就暴露，而不是等到管理员点发布。
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateAnnouncementDto, actorId: string): Promise<Announcement | PublishResult> {
    const audience = (dto.audience ?? 'ALL_TENANTS') as AnnouncementAudience;
    const targetIds = await this.resolveTargets(audience, dto.targetIds ?? []);

    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        priority: dto.priority ?? 'NORMAL',
        audience,
        targetIds,
        createdBy: actorId,
        expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : null,
        status: 'DRAFT',
      },
    });

    if (!dto.publish) return created;
    return this.publish(created.id);
  }

  async findAll(query: QueryAnnouncementsDto) {
    const { page = 1, limit = 20, status, q } = query;
    const where: Prisma.AnnouncementWhereInput = {};
    if (status) where.status = status;
    if (q?.trim()) {
      where.OR = [
        { title: { contains: q.trim(), mode: 'insensitive' } },
        { body: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { id: true, email: true } } },
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
      include: { creator: { select: { id: true, email: true } } },
    });
    if (!announcement) throw new NotFoundException('公告不存在');
    return announcement;
  }

  /**
   * 编辑仅限草稿。
   * 已发布的公告已经进入租客通知箱，改正文会造成「通知里的内容」与「公告内容」不一致；
   * 需要改内容时先归档再新建，保证已送达内容可追溯。
   */
  async update(id: string, dto: UpdateAnnouncementDto): Promise<Announcement> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('公告不存在');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('只有草稿可以编辑；已发布公告请归档后重新创建');
    }

    const audience = (dto.audience ?? existing.audience) as AnnouncementAudience;
    const targetIds = await this.resolveTargets(
      audience,
      dto.targetIds ?? (existing.targetIds as string[]),
    );

    return this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        priority: dto.priority ?? existing.priority,
        audience,
        targetIds,
        expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : null,
      },
    });
  }

  /** 发布（可重发）：解析受众 → 逐个投递通知 → 记录接收人数。 */
  async publish(id: string): Promise<PublishResult> {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException('公告不存在');
    if (announcement.status === 'ARCHIVED') {
      throw new ConflictException('已归档公告不能发布');
    }

    const recipients = await this.resolveRecipients(
      announcement.audience as AnnouncementAudience,
      announcement.targetIds as string[],
    );

    const errors: string[] = [];
    let delivered = 0;
    for (const recipient of recipients) {
      try {
        await this.notifications.create({
          userId: recipient.userId,
          title: announcement.title,
          body: announcement.body,
          priority:
            announcement.priority === 'URGENT'
              ? NotificationPriority.URGENT
              : NotificationPriority.NORMAL,
          data: {
            announcementId: announcement.id,
            audience: announcement.audience,
            template: 'GENERIC',
          },
          expiredAt: announcement.expiredAt?.toISOString(),
          dedupKey: announcementDedupKey(announcement.id, recipient.userId),
        });
        delivered += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${recipient.userId}: ${reason}`);
        this.logger.warn(`公告 ${id} 投递失败 userId=${recipient.userId}：${reason}`);
      }
    }

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: announcement.publishedAt ?? new Date(),
        recipientCount: recipients.length,
      },
    });

    return { announcement: updated, recipients: recipients.length, failed: recipients.length - delivered, errors };
  }

  /** 归档：停止出现在默认列表与「最新公告」，已送达的通知不回收。 */
  async archive(id: string): Promise<Announcement> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('公告不存在');
    if (existing.status === 'ARCHIVED') return existing;
    return this.prisma.announcement.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async remove(id: string) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('公告不存在');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('已发布公告不能删除，请改为归档');
    }
    await this.prisma.announcement.delete({ where: { id } });
    return { message: '公告已删除' };
  }

  /**
   * 解析受众为「可接收通知的用户」。
   *
   * 只认有登录账号（`Tenant.userId`）的租客：没有账号的租客收不到站内信，
   * 把它算进接收人数会造成「已发送 20 人、实际只到 12 人」的假象。
   */
  async resolveRecipients(
    audience: AnnouncementAudience,
    targetIds: string[],
  ): Promise<AnnouncementRecipient[]> {
    if (audience === 'ALL_TENANTS') {
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true, userId: { not: null } },
        select: { id: true, userId: true },
      });
      return tenants.map((tenant) => ({ tenantId: tenant.id, userId: tenant.userId! }));
    }

    if (audience === 'TENANTS') {
      return this.recipientsOfTenants(targetIds);
    }

    if (audience === 'BUILDING') {
      const contracts = await this.prisma.contract.findMany({
        where: { buildingId: { in: targetIds }, status: 'ACTIVE' },
        select: { tenantId: true },
      });
      return this.recipientsOfTenants(contracts.map((contract) => contract.tenantId));
    }

    // TAGS
    const tagged = await this.prisma.tenantTag.findMany({
      where: { tagId: { in: targetIds } },
      select: { tenantId: true },
    });
    return this.recipientsOfTenants(tagged.map((row) => row.tenantId));
  }

  private async recipientsOfTenants(tenantIds: string[]): Promise<AnnouncementRecipient[]> {
    const unique = Array.from(new Set(tenantIds.filter(Boolean)));
    if (unique.length === 0) return [];
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: unique }, isActive: true, userId: { not: null } },
      select: { id: true, userId: true },
    });
    return tenants.map((tenant) => ({ tenantId: tenant.id, userId: tenant.userId! }));
  }

  /** 目标校验：清洗 + 去重 + 存在性检查，避免把不存在 ID 存进公告。 */
  private async resolveTargets(audience: AnnouncementAudience, rawIds: string[]): Promise<string[]> {
    let ids: string[];
    try {
      ids = validateAudience({ audience, targetIds: rawIds });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '公告目标非法');
    }
    if (ids.length === 0) return [];

    const missing = await this.findMissingTargets(audience, ids);
    if (missing.length > 0) {
      throw new BadRequestException(`公告目标不存在：${missing.join(', ')}`);
    }
    return ids;
  }

  private async findMissingTargets(audience: AnnouncementAudience, ids: string[]): Promise<string[]> {
    if (audience === 'BUILDING') {
      const found = await this.prisma.building.findMany({ where: { id: { in: ids } }, select: { id: true } });
      return diff(ids, found.map((row) => row.id));
    }
    if (audience === 'TAGS') {
      const found = await this.prisma.tag.findMany({ where: { id: { in: ids } }, select: { id: true } });
      return diff(ids, found.map((row) => row.id));
    }
    if (audience === 'TENANTS') {
      const found = await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true } });
      return diff(ids, found.map((row) => row.id));
    }
    return [];
  }
}

function diff(requested: string[], found: string[]): string[] {
  const present = new Set(found);
  return requested.filter((id) => !present.has(id));
}
