import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: any;

  beforeEach(() => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'n1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      unreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
      markAllRead: vi.fn().mockResolvedValue({ count: 1 }),
      markRead: vi.fn().mockResolvedValue({ id: 'n1', isRead: true }),
      remove: vi.fn().mockResolvedValue({ message: '通知已删除' }),
      reportSubscribe: vi.fn().mockResolvedValue({ templateId: 't1', quota: 1, status: 'ACCEPTED' }),
      getSubscribeQuota: vi.fn().mockResolvedValue({ templateId: 't1', quota: 1 }),
    };
    controller = new NotificationsController(service as NotificationsService);
  });

  it('create 调用 service.create', async () => {
    const dto = { userId: 'u1', title: 't', body: 'b' };
    const res = await controller.create(dto);
    expect(res).toEqual({ id: 'n1' });
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll 调用 service.findAll', async () => {
    const res = await controller.findAll({ user: { userId: 'u1' } }, {} as any);
    expect(res).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findAll).toHaveBeenCalledWith('u1', {});
  });

  it('unreadCount 调用 service.unreadCount', async () => {
    const res = await controller.unreadCount({ user: { userId: 'u1' } });
    expect(res).toEqual({ unreadCount: 0 });
    expect(service.unreadCount).toHaveBeenCalledWith('u1');
  });

  it('reportSubscribe 接收上报并调用 service', async () => {
    const res = await controller.reportSubscribe(
      { user: { userId: 'u1' } },
      { templateId: 't1', action: 'accept' },
    );
    expect(res).toEqual({ templateId: 't1', quota: 1, status: 'ACCEPTED' });
    expect(service.reportSubscribe).toHaveBeenCalledWith('u1', { templateId: 't1', action: 'accept' });
  });

  it('getSubscribeQuota 调用 service.getSubscribeQuota', async () => {
    const res = await controller.getSubscribeQuota({ user: { userId: 'u1' } }, 't1');
    expect(res).toEqual({ templateId: 't1', quota: 1 });
    expect(service.getSubscribeQuota).toHaveBeenCalledWith('u1', 't1');
  });

  it('markAllRead 调用 service.markAllRead', async () => {
    const res = await controller.markAllRead({ user: { userId: 'u1' } });
    expect(res).toEqual({ count: 1 });
  });

  it('markRead 调用 service.markRead', async () => {
    const res = await controller.markRead({ user: { userId: 'u1' } }, 'n1');
    expect(res).toEqual({ id: 'n1', isRead: true });
  });

  it('remove 调用 service.remove', async () => {
    const res = await controller.remove({ user: { userId: 'u1' } }, 'n1');
    expect(res).toEqual({ message: '通知已删除' });
  });
});
