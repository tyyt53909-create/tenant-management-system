import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationDispatcher } from './channels/notification-dispatcher.js';
import { WechatSubscribeQuotaService } from './wechat-subscribe-quota.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let quotaService: any;

  beforeEach(async () => {
    quotaService = {
      recordReport: vi.fn().mockResolvedValue({ templateId: 't1', quota: 1, status: 'ACCEPTED' }),
      getQuota: vi.fn().mockResolvedValue(2),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        // QLT-02 / T288：dispatcher 改为必填，用真实默认渠道（站内信写 notification 表）
        {
          provide: NotificationDispatcher,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => NotificationDispatcher.createDefault(prisma),
        },
        {
          provide: WechatSubscribeQuotaService,
          useValue: quotaService,
        },
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

  it('同一去重键冲突时返回已有通知', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 'user-1' } as any);
    vi.spyOn(prisma.notification, 'create').mockRejectedValue({ code: 'P2002' });
    vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
      id: 'n-existing',
      userId: 'user-1',
      dedupKey: 'BILL_OVERDUE:user-1:bill-1',
    } as any);

    const result = (await service.create({
      userId: 'user-1',
      title: '账单逾期提醒',
      body: '请缴费',
      dedupKey: 'BILL_OVERDUE:user-1:bill-1',
      data: { billId: 'bill-1' },
    })) as any;

    expect(result.id).toBe('n-existing');
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

  it('reportSubscribe 委托调用 quotaService', async () => {
    const res = await service.reportSubscribe('user-1', { templateId: 'tmpl-1', action: 'accept' });
    expect(res).toEqual({ templateId: 't1', quota: 1, status: 'ACCEPTED' });
    expect(quotaService.recordReport).toHaveBeenCalledWith('user-1', 'tmpl-1', 'accept');
  });

  it('getSubscribeQuota 委托调用 quotaService', async () => {
    const res = await service.getSubscribeQuota('user-1', 'tmpl-1');
    expect(res).toEqual({ templateId: 'tmpl-1', quota: 2 });
    expect(quotaService.getQuota).toHaveBeenCalledWith('user-1', 'tmpl-1');
  });
});
