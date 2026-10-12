import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: vi.fn() },
            notification: {
              create: vi.fn(),
              findMany: vi.fn(),
              findUnique: vi.fn(),
              count: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              delete: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('创建通知时接收用户不存在应抛错', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    await expect(
      service.create({ userId: 'no-user', title: 't', body: 'b' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('查询列表应只返回本人通知并附带未读数', async () => {
    vi.spyOn(prisma.notification, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.notification, 'count').mockResolvedValue(0);
    const result = await service.findAll('user-1', {});
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(result.meta.unreadCount).toBe(0);
  });

  it('标记他人通知已读应抛 Forbidden', async () => {
    vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
      id: 'n-1',
      userId: 'other-user',
    } as any);
    await expect(service.markRead('n-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('删除他人通知应抛 Forbidden', async () => {
    vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
      id: 'n-1',
      userId: 'other-user',
    } as any);
    await expect(service.remove('n-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('全部标记已读应返回计数', async () => {
    vi.spyOn(prisma.notification, 'updateMany').mockResolvedValue({ count: 3 } as any);
    const result = await service.markAllRead('user-1');
    expect(result.count).toBe(3);
  });
});
