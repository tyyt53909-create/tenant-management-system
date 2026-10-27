import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { CreateCleaningTaskDto } from './dto/create-cleaning-task.dto.js';
import { QueryCleaningTasksDto } from './dto/query-cleaning-tasks.dto.js';
import { AssignCleanerDto } from './dto/assign-cleaner.dto.js';
import { CompleteCleaningDto } from './dto/complete-cleaning.dto.js';
import { AcceptCleaningDto, RejectCleaningDto } from './dto/accept-cleaning.dto.js';
import { CleaningTaskStatus, CleaningTaskType, Prisma } from '@prisma/client';
import { randomHex } from '../../common/utils/secure-random.js';
import { assertStaffBuildingAccess, getStaffBuildingScope } from '../../common/utils/building-scope.util.js';

@Injectable()
export class CleaningService {
  private readonly logger = new Logger(CleaningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
  ) {}

  /**
   * 创建保洁工单任务（手动）
   */
  async create(dto: CreateCleaningTaskDto, operator: { userId: string; role: string }) {
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { building: true },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    if (operator.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, room.buildingId);
    }

    let status: CleaningTaskStatus = CleaningTaskStatus.PENDING;
    let assignedAt: Date | undefined;
    let assignedBy: string | undefined;

    if (dto.cleanerId) {
      const cleaner = await this.prisma.user.findUnique({
        where: { id: dto.cleanerId },
      });
      if (!cleaner || cleaner.role !== 'CLEANER' || !cleaner.isActive) {
        throw new BadRequestException('指定的保洁员不存在或角色不合法');
      }
      status = CleaningTaskStatus.ASSIGNED;
      assignedAt = new Date();
      assignedBy = operator.userId;
    }

    const todayStr = this.clock.formatDate().replace(/-/g, '');
    const taskNumber = `CL-${todayStr}-${randomHex(3).toUpperCase()}`;

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cleaningTask.create({
        data: {
          taskNumber,
          buildingId: room.buildingId,
          roomId: room.id,
          type: dto.type || CleaningTaskType.CHECKOUT,
          status,
          cleanerId: dto.cleanerId,
          assignedAt,
          assignedBy,
          beforePhotos: dto.beforePhotos || [],
          notes: dto.notes,
          source: 'MANUAL',
        },
        include: {
          building: { select: { id: true, name: true } },
          room: { select: { id: true, roomNumber: true, status: true, cleanStatus: true } },
          cleaner: { select: { id: true, email: true, phone: true } },
        },
      });

      // 联动：将房间设为待清洁
      if (room.cleanStatus === 'CLEAN') {
        await tx.room.update({
          where: { id: room.id },
          data: { cleanStatus: 'PENDING_CLEAN' },
        });
      }

      return created;
    });

    this.logger.log(`创建保洁工单: ${task.taskNumber}, 房间: ${room.roomNumber}`);
    return task;
  }

  /**
   * 退租完成或房态转待清洁时自动生成退租保洁工单（幂等）
   */
  async autoCreateForCheckout(roomId: string, checkoutRecordId?: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });
    if (!room) return null;

    // 幂等：若同房间已有非归档的保洁工单，不重复建单
    const existing = await this.prisma.cleaningTask.findFirst({
      where: {
        roomId,
        status: { in: [CleaningTaskStatus.PENDING, CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.IN_PROGRESS, CleaningTaskStatus.COMPLETED] },
      },
    });

    if (existing) {
      return existing;
    }

    const todayStr = this.clock.formatDate().replace(/-/g, '');
    const taskNumber = `CL-${todayStr}-${randomHex(3).toUpperCase()}`;

    return this.prisma.cleaningTask.create({
      data: {
        taskNumber,
        buildingId: room.buildingId,
        roomId: room.id,
        type: CleaningTaskType.CHECKOUT,
        status: CleaningTaskStatus.PENDING,
        source: 'CHECKOUT_AUTO',
        sourceId: checkoutRecordId,
        notes: checkoutRecordId ? `退租记录 ${checkoutRecordId} 自动生成保洁任务` : '退租自动生成保洁任务',
      },
    });
  }

  /**
   * 分页查询保洁任务列表
   */
  async findAll(query: QueryCleaningTasksDto, user: { userId: string; role: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CleaningTaskWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.roomId) where.roomId = query.roomId;
    if (query.cleanerId) where.cleanerId = query.cleanerId;

    if (user.role === 'PROPERTY_MANAGER') {
      const allowedBuildingIds = await getStaffBuildingScope(this.prisma, user);
      if (allowedBuildingIds !== null) {
        if (query.buildingId) {
          if (!allowedBuildingIds.includes(query.buildingId)) {
            return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
          }
          where.buildingId = query.buildingId;
        } else {
          where.buildingId = { in: allowedBuildingIds };
        }
      } else if (query.buildingId) {
        where.buildingId = query.buildingId;
      }
    } else if (query.buildingId) {
      where.buildingId = query.buildingId;
    }

    const [total, data] = await Promise.all([
      this.prisma.cleaningTask.count({ where }),
      this.prisma.cleaningTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          building: { select: { id: true, name: true } },
          room: { select: { id: true, roomNumber: true, status: true, cleanStatus: true } },
          cleaner: { select: { id: true, email: true, phone: true } },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 保洁员专属：查看指派给本人的任务
   */
  async findAssignedToCleaner(cleanerId: string, query: QueryCleaningTasksDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CleaningTaskWhereInput = {
      cleanerId,
      status: query.status || { in: [CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.IN_PROGRESS, CleaningTaskStatus.COMPLETED] },
    };

    const [total, data] = await Promise.all([
      this.prisma.cleaningTask.count({ where }),
      this.prisma.cleaningTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          building: { select: { id: true, name: true } },
          room: { select: { id: true, roomNumber: true, status: true, cleanStatus: true } },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 查询单条工单详情
   */
  async findOne(id: string, user: { userId: string; role: string }) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id },
      include: {
        building: { select: { id: true, name: true } },
        room: { select: { id: true, roomNumber: true, status: true, cleanStatus: true } },
        cleaner: { select: { id: true, email: true, phone: true } },
      },
    });

    if (!task) {
      throw new NotFoundException('保洁工单不存在');
    }

    if (user.role === 'CLEANER' && task.cleanerId !== user.userId) {
      throw new ForbiddenException('您无权查看未指派给您的保洁工单');
    }

    if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, task.buildingId);
    }

    return task;
  }

  /**
   * 指派保洁员
   */
  async assignCleaner(id: string, dto: AssignCleanerDto, operator: { userId: string; role: string }) {
    const task = await this.findOne(id, operator);

    if (task.status === CleaningTaskStatus.COMPLETED || task.status === CleaningTaskStatus.ACCEPTED || task.status === CleaningTaskStatus.CANCELLED) {
      throw new BadRequestException(`工单当前为 ${task.status} 状态，不可重新指派`);
    }

    const cleaner = await this.prisma.user.findUnique({
      where: { id: dto.cleanerId },
    });
    if (!cleaner || cleaner.role !== 'CLEANER' || !cleaner.isActive) {
      throw new BadRequestException('指定的保洁员不存在或角色不合法');
    }

    return this.prisma.cleaningTask.update({
      where: { id },
      data: {
        cleanerId: dto.cleanerId,
        assignedBy: operator.userId,
        assignedAt: new Date(),
        status: CleaningTaskStatus.ASSIGNED,
      },
      include: {
        cleaner: { select: { id: true, email: true, phone: true } },
        room: { select: { id: true, roomNumber: true } },
      },
    });
  }

  /**
   * 保洁员接单/开工
   */
  async startCleaning(id: string, user: { userId: string; role: string }) {
    const task = await this.findOne(id, user);

    if (user.role === 'CLEANER' && task.cleanerId !== user.userId) {
      throw new ForbiddenException('只能对指派给本人的工单开工');
    }

    if (task.status === CleaningTaskStatus.IN_PROGRESS) {
      return task;
    }

    if (task.status !== CleaningTaskStatus.ASSIGNED && task.status !== CleaningTaskStatus.PENDING) {
      throw new BadRequestException(`当前工单状态为 ${task.status}，不可开工`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id },
        data: {
          status: CleaningTaskStatus.IN_PROGRESS,
          startedAt: new Date(),
          cleanerId: task.cleanerId || user.userId,
        },
      });

      // 联动：房间清洁中
      await tx.room.update({
        where: { id: task.roomId },
        data: { cleanStatus: 'CLEANING' },
      });

      return updated;
    });
  }

  /**
   * 保洁员提报完工
   */
  async completeCleaning(id: string, dto: CompleteCleaningDto, user: { userId: string; role: string }) {
    const task = await this.findOne(id, user);

    if (user.role === 'CLEANER' && task.cleanerId !== user.userId) {
      throw new ForbiddenException('只能提报指派给本人的工单');
    }

    if (task.status !== CleaningTaskStatus.IN_PROGRESS && task.status !== CleaningTaskStatus.ASSIGNED) {
      throw new BadRequestException(`当前工单状态为 ${task.status}，不可提报完工`);
    }

    return this.prisma.cleaningTask.update({
      where: { id },
      data: {
        status: CleaningTaskStatus.COMPLETED,
        completedAt: new Date(),
        afterPhotos: dto.afterPhotos || [],
        notes: dto.notes || task.notes,
      },
      include: {
        room: { select: { id: true, roomNumber: true, cleanStatus: true } },
      },
    });
  }

  /**
   * 管家/管理员验收通过并归档
   */
  async acceptCleaning(id: string, dto: AcceptCleaningDto, operator: { userId: string; role: string }) {
    const task = await this.findOne(id, operator);

    if (operator.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, task.buildingId);
    }

    if (task.status !== CleaningTaskStatus.COMPLETED) {
      throw new BadRequestException(`保洁工单未完工（当前为 ${task.status} 状态），不可验收`);
    }

    return this.prisma.$transaction(async (tx) => {
      const accepted = await tx.cleaningTask.update({
        where: { id },
        data: {
          status: CleaningTaskStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedBy: operator.userId,
          rating: dto.rating ?? 5,
          acceptanceNotes: dto.acceptanceNotes,
        },
      });

      // 核心联动：房间清洁完成，房态正式恢复 CLEAN！
      await tx.room.update({
        where: { id: task.roomId },
        data: { cleanStatus: 'CLEAN' },
      });

      return accepted;
    });
  }

  /**
   * 验收驳回返工
   */
  async rejectCleaning(id: string, dto: RejectCleaningDto, operator: { userId: string; role: string }) {
    const task = await this.findOne(id, operator);

    if (operator.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, task.buildingId);
    }

    if (task.status !== CleaningTaskStatus.COMPLETED) {
      throw new BadRequestException(`当前工单状态为 ${task.status}，不可驳回`);
    }

    return this.prisma.cleaningTask.update({
      where: { id },
      data: {
        status: CleaningTaskStatus.IN_PROGRESS,
        notes: dto.reason ? `[验收驳回] ${dto.reason}` : task.notes,
      },
    });
  }

  /**
   * 取消工单
   */
  async cancel(id: string, operator: { userId: string; role: string }, reason?: string) {
    const task = await this.findOne(id, operator);

    if (task.status === CleaningTaskStatus.ACCEPTED || task.status === CleaningTaskStatus.CANCELLED) {
      throw new BadRequestException(`当前工单状态为 ${task.status}，不可取消`);
    }

    return this.prisma.cleaningTask.update({
      where: { id },
      data: {
        status: CleaningTaskStatus.CANCELLED,
        notes: reason ? `[取消] ${reason}` : task.notes,
      },
    });
  }
}
