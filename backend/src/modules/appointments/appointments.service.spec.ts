import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let prisma: any;
  let notificationsService: any;

  beforeEach(async () => {
    const prismaMock: any = {
      viewingAppointment: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

    notificationsService = {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
    prisma = prismaMock;
  });

  describe('findAll & findMy', () => {
    it('findAll：按状态和日期范围分页查询', async () => {
      prisma.viewingAppointment.findMany.mockResolvedValue([{ id: 'a1' }]);
      prisma.viewingAppointment.count.mockResolvedValue(1);

      const res = await service.findAll({
        page: 1,
        limit: 10,
        status: 'PENDING',
        startDate: '2026-10-01',
      });

      expect(res.data).toHaveLength(1);
      expect(prisma.viewingAppointment.findMany).toHaveBeenCalled();
    });

    it('findMy：根据用户 ID 查询个人看房记录', async () => {
      prisma.viewingAppointment.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1' }]);

      const res = await service.findMy('u1', '13800000000');
      expect(res).toHaveLength(1);
      expect(prisma.viewingAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ userId: 'u1' }, { phone: '13800000000' }],
          },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('预约不存在抛出 NotFoundException', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue(null);
      await expect(service.findOne('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('成功确认排期并通知预约租客', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
        userId: 'u1',
        roomId: 'r1',
        notes: '原备注',
      });
      prisma.viewingAppointment.update.mockResolvedValue({
        id: 'a1',
        status: 'CONFIRMED',
        userId: 'u1',
        roomId: 'r1',
        room: { roomNumber: '101', building: { name: 'A栋' } },
      });

      const res = await service.confirm('a1', { notes: '上午10点接待' }, 'admin-1');

      expect(res.status).toBe('CONFIRMED');
      expect(prisma.viewingAppointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1' },
          data: expect.objectContaining({
            status: 'CONFIRMED',
            confirmedBy: 'admin-1',
          }),
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          title: '看房预约已确认',
        }),
      );
    });

    it('非 PENDING 状态确认抛出 BadRequestException', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'CONFIRMED',
      });

      await expect(
        service.confirm('a1', {}, 'admin-1'),
      ).rejects.toThrow('只有待确认状态的预约可确认排期');
    });
  });

  describe('complete', () => {
    it('已确认预约成功标记完成并记录带看反馈', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'CONFIRMED',
      });
      prisma.viewingAppointment.update.mockResolvedValue({
        id: 'a1',
        status: 'COMPLETED',
        feedback: '客户有意向签约',
      });

      const res = await service.complete('a1', { feedback: '客户有意向签约' });
      expect(res.status).toBe('COMPLETED');
    });

    it('非 CONFIRMED 状态完成抛出 BadRequestException', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
      });

      await expect(
        service.complete('a1', {}),
      ).rejects.toThrow('只有已排期确认的预约可标记为已看房');
    });
  });

  describe('cancel', () => {
    it('租客取消他人预约抛出 ForbiddenException', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
        userId: 'other-user',
      });

      await expect(
        service.cancel('a1', {}, 'user-1', 'TENANT', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('已完成预约取消抛出 BadRequestException', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'COMPLETED',
      });

      await expect(
        service.cancel('a1', {}, 'admin-1', 'ADMIN'),
      ).rejects.toThrow(BadRequestException);
    });

    it('正常取消成功', async () => {
      prisma.viewingAppointment.findUnique.mockResolvedValue({
        id: 'a1',
        status: 'PENDING',
      });
      prisma.viewingAppointment.update.mockResolvedValue({
        id: 'a1',
        status: 'CANCELLED',
        cancelledReason: '行程冲突',
      });

      const res = await service.cancel('a1', { reason: '行程冲突' }, 'admin-1', 'ADMIN');
      expect(res.status).toBe('CANCELLED');
    });
  });
});
