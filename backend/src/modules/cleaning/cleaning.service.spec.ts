import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CleaningService } from './cleaning.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';
import { CleaningTaskStatus, CleaningTaskType } from '@prisma/client';

describe('CleaningService (WRK-03 / T304)', () => {
  let service: CleaningService;
  let prisma: any;
  let clock: BusinessClock;

  beforeEach(() => {
    clock = new BusinessClock(new ConfigService({ BUSINESS_TIMEZONE: 'Asia/Shanghai' }));
    prisma = {
      room: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      staffBuildingAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      cleaningTask: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    service = new CleaningService(prisma, clock);
  });

  describe('create', () => {
    it('房间不存在抛出 NotFoundException', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ roomId: 'r-not-exist' }, { userId: 'u1', role: 'ADMIN' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('管家越权访问未管辖楼栋抛出 ForbiddenException', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', buildingId: 'b1' });
      prisma.staffBuildingAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ roomId: 'r1' }, { userId: 'manager-1', role: 'PROPERTY_MANAGER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('指派非 CLEANER 角色用户抛出 BadRequestException', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', buildingId: 'b1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', role: 'TENANT', isActive: true });

      await expect(
        service.create({ roomId: 'r1', cleanerId: 'u2' }, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('正常创建保洁工单并将 CLEAN 房态自动置为 PENDING_CLEAN', async () => {
      prisma.room.findUnique.mockResolvedValue({
        id: 'r1',
        buildingId: 'b1',
        cleanStatus: 'CLEAN',
        roomNumber: '101',
      });
      prisma.cleaningTask.create.mockResolvedValue({
        id: 'task-1',
        taskNumber: 'CL-20261028-001',
        status: CleaningTaskStatus.PENDING,
      });

      const res = await service.create({ roomId: 'r1' }, { userId: 'admin', role: 'ADMIN' });
      expect(res.id).toBe('task-1');
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { cleanStatus: 'PENDING_CLEAN' },
      });
    });
  });

  describe('autoCreateForCheckout (幂等退租建单)', () => {
    it('房间不存在返回 null', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      const res = await service.autoCreateForCheckout('r-none');
      expect(res).toBeNull();
    });

    it('同一房间已有未归档保洁工单时不重复生成 (幂等)', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', buildingId: 'b1' });
      prisma.cleaningTask.findFirst.mockResolvedValue({
        id: 'task-existing',
        status: CleaningTaskStatus.PENDING,
      });

      const res = await service.autoCreateForCheckout('r1', 'chk-001');
      expect(res?.id).toBe('task-existing');
      expect(prisma.cleaningTask.create).not.toHaveBeenCalled();
    });

    it('退租成功自动生成 CHECKOUT_AUTO 保洁任务', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'r1', buildingId: 'b1' });
      prisma.cleaningTask.findFirst.mockResolvedValue(null);
      prisma.cleaningTask.create.mockResolvedValue({
        id: 'task-auto',
        type: CleaningTaskType.CHECKOUT,
        source: 'CHECKOUT_AUTO',
      });

      const res = await service.autoCreateForCheckout('r1', 'chk-001');
      expect(res?.id).toBe('task-auto');
      expect(prisma.cleaningTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomId: 'r1',
            type: CleaningTaskType.CHECKOUT,
            source: 'CHECKOUT_AUTO',
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('管家查询时自动添加管辖楼栋过滤条件', async () => {
      prisma.staffBuildingAssignment.findMany.mockResolvedValue([{ buildingId: 'b-allowed' }]);
      prisma.cleaningTask.count.mockResolvedValue(1);
      prisma.cleaningTask.findMany.mockResolvedValue([{ id: 't1' }]);

      const res = await service.findAll({}, { userId: 'pm-1', role: 'PROPERTY_MANAGER' });
      expect(res.data.length).toBe(1);
      expect(prisma.cleaningTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            buildingId: { in: ['b-allowed'] },
          }),
        }),
      );
    });
  });

  describe('findAssignedToCleaner', () => {
    it('保洁员仅查指派给自己的工单', async () => {
      prisma.cleaningTask.count.mockResolvedValue(2);
      prisma.cleaningTask.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

      const res = await service.findAssignedToCleaner('cleaner-1', {});
      expect(res.data.length).toBe(2);
      expect(prisma.cleaningTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cleanerId: 'cleaner-1',
          }),
        }),
      );
    });
  });

  describe('assignCleaner', () => {
    it('已完工工单不可重新指派', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.COMPLETED,
        buildingId: 'b1',
      });

      await expect(
        service.assignCleaner('t1', { cleanerId: 'c1' }, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('成功指派保洁师傅', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.PENDING,
        buildingId: 'b1',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'c1', role: 'CLEANER', isActive: true });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.ASSIGNED,
        cleanerId: 'c1',
      });

      const res = await service.assignCleaner(
        't1',
        { cleanerId: 'c1' },
        { userId: 'admin', role: 'ADMIN' },
      );
      expect(res.status).toBe(CleaningTaskStatus.ASSIGNED);
    });
  });

  describe('startCleaning', () => {
    it('非指派保洁员开工被拒绝', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        cleanerId: 'other-cleaner',
        status: CleaningTaskStatus.ASSIGNED,
      });

      await expect(
        service.startCleaning('t1', { userId: 'my-cleaner', role: 'CLEANER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('开工成功流转至 IN_PROGRESS 并联动房间状态为 CLEANING', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        cleanerId: 'c1',
        roomId: 'r1',
        status: CleaningTaskStatus.ASSIGNED,
      });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.IN_PROGRESS,
      });

      const res = await service.startCleaning('t1', { userId: 'c1', role: 'CLEANER' });
      expect(res.status).toBe(CleaningTaskStatus.IN_PROGRESS);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { cleanStatus: 'CLEANING' },
      });
    });
  });

  describe('completeCleaning', () => {
    it('提报完工流转至 COMPLETED 并记录照片', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        cleanerId: 'c1',
        status: CleaningTaskStatus.IN_PROGRESS,
      });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.COMPLETED,
        afterPhotos: ['photo1.jpg'],
      });

      const res = await service.completeCleaning(
        't1',
        { afterPhotos: ['photo1.jpg'], notes: '已清理完成' },
        { userId: 'c1', role: 'CLEANER' },
      );
      expect(res.status).toBe(CleaningTaskStatus.COMPLETED);
    });
  });

  describe('acceptCleaning (验收合格与房态恢复)', () => {
    it('未完工工单不可验收', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.IN_PROGRESS,
        buildingId: 'b1',
      });

      await expect(
        service.acceptCleaning('t1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('验收通过流转至 ACCEPTED 并原子恢复房间 cleanStatus = CLEAN', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.COMPLETED,
        roomId: 'r1',
        buildingId: 'b1',
      });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.ACCEPTED,
        rating: 5,
      });

      const res = await service.acceptCleaning(
        't1',
        { rating: 5, acceptanceNotes: '清洁非常彻底' },
        { userId: 'admin', role: 'ADMIN' },
      );

      expect(res.status).toBe(CleaningTaskStatus.ACCEPTED);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { cleanStatus: 'CLEAN' },
      });
    });
  });

  describe('rejectCleaning', () => {
    it('验收不合格驳回返工流转回 IN_PROGRESS', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.COMPLETED,
        buildingId: 'b1',
      });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.IN_PROGRESS,
      });

      const res = await service.rejectCleaning(
        't1',
        { reason: '卫生间地面未拖干净' },
        { userId: 'admin', role: 'ADMIN' },
      );
      expect(res.status).toBe(CleaningTaskStatus.IN_PROGRESS);
    });

    it('未完工工单不可驳回', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.IN_PROGRESS,
        buildingId: 'b1',
      });

      await expect(
        service.rejectCleaning('t1', { reason: 'bad' }, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('已完成或已归档工单不可取消', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.ACCEPTED,
        buildingId: 'b1',
      });

      await expect(
        service.cancel('t1', { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('正常取消工单', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.PENDING,
        buildingId: 'b1',
      });
      prisma.cleaningTask.update.mockResolvedValue({
        id: 't1',
        status: CleaningTaskStatus.CANCELLED,
      });

      const res = await service.cancel('t1', { userId: 'admin', role: 'ADMIN' }, '不再需要保洁');
      expect(res.status).toBe(CleaningTaskStatus.CANCELLED);
    });
  });

  describe('findOne', () => {
    it('工单不存在抛出 NotFoundException', async () => {
      prisma.cleaningTask.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('t-not-exist', { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
