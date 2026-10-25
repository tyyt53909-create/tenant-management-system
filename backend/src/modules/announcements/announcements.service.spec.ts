import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';

function makePrisma() {
  return {
    announcement: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    tenant: { findMany: vi.fn() },
    tenantTag: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    building: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
  };
}

const draft = {
  id: 'a1',
  title: '停水通知',
  body: '本周六 9:00-12:00 停水',
  priority: 'NORMAL' as const,
  status: 'DRAFT' as const,
  audience: 'ALL_TENANTS' as const,
  targetIds: [] as string[],
  createdBy: 'admin-1',
  publishAt: null,
  expiredAt: null,
  publishedAt: null,
  recipientCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AnnouncementsService（T284）', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let notifications: { create: ReturnType<typeof vi.fn> };
  let service: AnnouncementsService;

  beforeEach(() => {
    prisma = makePrisma();
    notifications = { create: vi.fn().mockResolvedValue({ id: 'n1' }) };
    service = new AnnouncementsService(prisma as never, notifications as never);
  });

  describe('目标校验', () => {
    it('ALL_TENANTS 忽略残留 targetIds', async () => {
      prisma.announcement.create.mockResolvedValue(draft);
      await service.create(
        { title: 't', body: 'b', audience: 'ALL_TENANTS', targetIds: ['stale'] },
        'admin-1',
      );
      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ audience: 'ALL_TENANTS', targetIds: [] }),
      });
    });

    it('定向公告缺少目标 ID → 400，且不落库', async () => {
      await expect(
        service.create({ title: 't', body: 'b', audience: 'BUILDING', targetIds: [] }, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });

    it('目标 ID 不存在 → 400 并列出缺失 ID', async () => {
      prisma.building.findMany.mockResolvedValue([{ id: 'b1' }]);
      await expect(
        service.create(
          { title: 't', body: 'b', audience: 'BUILDING', targetIds: ['b1', 'b2'] },
          'admin-1',
        ),
      ).rejects.toThrow(/b2/);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });

    it('重复目标 ID 去重后保存', async () => {
      prisma.tag.findMany.mockResolvedValue([{ id: 'g1' }]);
      prisma.announcement.create.mockResolvedValue({ ...draft, audience: 'TAGS', targetIds: ['g1'] });
      await service.create(
        { title: 't', body: 'b', audience: 'TAGS', targetIds: ['g1', 'g1', ' g1 '] },
        'admin-1',
      );
      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ audience: 'TAGS', targetIds: ['g1'] }),
      });
    });
  });

  describe('受众解析', () => {
    it('ALL_TENANTS 只包含有账号且启用中的租客', async () => {
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't1', userId: 'u1' },
        { id: 't2', userId: 'u2' },
      ]);
      const recipients = await service.resolveRecipients('ALL_TENANTS', []);
      expect(prisma.tenant.findMany).toHaveBeenCalledWith({
        where: { isActive: true, userId: { not: null } },
        select: { id: true, userId: true },
      });
      expect(recipients).toEqual([
        { tenantId: 't1', userId: 'u1' },
        { tenantId: 't2', userId: 'u2' },
      ]);
    });

    it('BUILDING 只取该楼栋 ACTIVE 合同，并去重', async () => {
      prisma.contract.findMany.mockResolvedValue([{ tenantId: 't1' }, { tenantId: 't1' }]);
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1', userId: 'u1' }]);
      const recipients = await service.resolveRecipients('BUILDING', ['b1']);
      expect(prisma.contract.findMany).toHaveBeenCalledWith({
        where: { buildingId: { in: ['b1'] }, status: 'ACTIVE' },
        select: { tenantId: true },
      });
      expect(prisma.tenant.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['t1'] }, isActive: true, userId: { not: null } },
        select: { id: true, userId: true },
      });
      expect(recipients).toEqual([{ tenantId: 't1', userId: 'u1' }]);
    });

    it('TAGS 走租客标签关联', async () => {
      prisma.tenantTag.findMany.mockResolvedValue([{ tenantId: 't1' }]);
      prisma.tenant.findMany.mockResolvedValue([]);
      await service.resolveRecipients('TAGS', ['g1']);
      expect(prisma.tenantTag.findMany).toHaveBeenCalledWith({
        where: { tagId: { in: ['g1'] } },
        select: { tenantId: true },
      });
    });

    it('没有匹配租客时返回空数组，不抛错', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);
      await expect(service.resolveRecipients('TENANTS', ['missing'])).resolves.toEqual([]);
    });
  });

  describe('发布', () => {
    it('按去重键逐个投递并记录接收人数', async () => {
      prisma.announcement.findUnique.mockResolvedValue(draft);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't1', userId: 'u1' },
        { id: 't2', userId: 'u2' },
      ]);
      prisma.announcement.update.mockResolvedValue({
        ...draft,
        status: 'PUBLISHED',
        recipientCount: 2,
      });

      const result = await service.publish('a1');

      expect(notifications.create).toHaveBeenCalledTimes(2);
      expect(notifications.create.mock.calls[0][0]).toMatchObject({
        userId: 'u1',
        title: '停水通知',
        dedupKey: 'ANNOUNCEMENT:a1:u1',
        data: expect.objectContaining({ announcementId: 'a1', template: 'GENERIC' }),
      });
      expect(notifications.create.mock.calls[1][0].dedupKey).toBe('ANNOUNCEMENT:a1:u2');
      expect(result).toMatchObject({ recipients: 2, failed: 0 });
      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: 'PUBLISHED', recipientCount: 2 }),
      });
    });

    it('个别用户投递失败不影响其他人，失败数被记录', async () => {
      prisma.announcement.findUnique.mockResolvedValue(draft);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't1', userId: 'u1' },
        { id: 't2', userId: 'u2' },
      ]);
      notifications.create
        .mockResolvedValueOnce({ id: 'n1' })
        .mockRejectedValueOnce(new Error('smtp down'));
      prisma.announcement.update.mockResolvedValue({ ...draft, status: 'PUBLISHED', recipientCount: 2 });

      const result = await service.publish('a1');

      expect(result.recipients).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('u2');
    });

    it('已归档公告拒绝发布；不存在 → 404', async () => {
      prisma.announcement.findUnique.mockResolvedValueOnce({ ...draft, status: 'ARCHIVED' });
      await expect(service.publish('a1')).rejects.toBeInstanceOf(ConflictException);

      prisma.announcement.findUnique.mockResolvedValueOnce(null);
      await expect(service.publish('a2')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('生命周期', () => {
    it('已发布公告不能编辑、不能删除', async () => {
      prisma.announcement.findUnique.mockResolvedValue({ ...draft, status: 'PUBLISHED' });
      await expect(service.update('a1', { title: 't', body: 'b' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.remove('a1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.announcement.delete).not.toHaveBeenCalled();
    });

    it('草稿可以删除；归档幂等', async () => {
      prisma.announcement.findUnique.mockResolvedValue(draft);
      prisma.announcement.delete.mockResolvedValue(draft);
      await expect(service.remove('a1')).resolves.toEqual({ message: '公告已删除' });

      prisma.announcement.findUnique.mockResolvedValue({ ...draft, status: 'ARCHIVED' });
      await expect(service.archive('a1')).resolves.toMatchObject({ status: 'ARCHIVED' });
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });

    it('创建时 publish=true 直接发布', async () => {
      prisma.announcement.create.mockResolvedValue(draft);
      prisma.announcement.findUnique.mockResolvedValue(draft);
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1', userId: 'u1' }]);
      prisma.announcement.update.mockResolvedValue({ ...draft, status: 'PUBLISHED', recipientCount: 1 });

      const result = await service.create({ title: 't', body: 'b', publish: true }, 'admin-1');
      expect('recipients' in result).toBe(true);
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });
  });
});
