import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto.js';
import { QueryRoomsDto } from './dto/query-rooms.dto.js';

/** 允许的房态流转（docs/04-状态机.md §1.3，键与值均为 `status+cleanStatus`） */
const ALLOWED_ROOM_TRANSITIONS: Record<string, string[]> = {
  'VACANT+CLEAN': ['RESERVED+CLEAN', 'MAINTENANCE+CLEAN'],
  'RESERVED+CLEAN': ['OCCUPIED+CLEAN'],
  'OCCUPIED+CLEAN': ['VACANT+PENDING_CLEAN', 'MAINTENANCE+CLEAN'],
  'MAINTENANCE+CLEAN': ['OCCUPIED+CLEAN', 'VACANT+PENDING_CLEAN'],
  'VACANT+PENDING_CLEAN': ['VACANT+CLEANING'],
  'VACANT+CLEANING': ['VACANT+CLEAN'],
};

const VERSION_CONFLICT_MESSAGE = '房间状态已被其他用户修改，请刷新后重试';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRoomDto) {
    // 1. 验证楼栋是否存在
    const building = await this.prisma.building.findUnique({
      where: { id: dto.buildingId },
    });

    if (!building) {
      throw new BadRequestException('楼栋不存在');
    }

    // 2. 检查房号唯一性（同一楼栋下）
    const existingRoom = await this.prisma.room.findFirst({
      where: {
        buildingId: dto.buildingId,
        floor: dto.floor,
        roomNumber: dto.roomNumber,
      },
    });

    if (existingRoom) {
      throw new ConflictException('该楼栋下该楼层的房号已存在');
    }

    // 3. 创建房源
    return this.prisma.room.create({
      data: {
        roomNumber: dto.roomNumber,
        buildingId: dto.buildingId,
        floor: dto.floor,
        roomType: dto.roomType,
        area: dto.area,
        facilities: dto.facilities,
        description: dto.description,
        status: 'VACANT', // 默认空闲
        cleanStatus: 'CLEAN', // 默认已清洁
      },
    });
  }

  async findAll(query: QueryRoomsDto) {
    const { page = 1, limit = 20, status, buildingId } = query;
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (buildingId) {
      where.buildingId = buildingId;
    }

    // 注意：Prisma Schema 中没有 monthlyRent 字段
    // 租金信息在 Contract 表中，这里暂时忽略租金筛选

    // 查询数据和总数
    const [data, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          building: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        building: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    return room;
  }

  async update(id: string, dto: UpdateRoomDto) {
    // 1. 检查房源是否存在
    const room = await this.prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    // 2. 如果修改了楼栋或房号或楼层，检查唯一性
    if (dto.buildingId !== undefined || dto.roomNumber !== undefined || dto.floor !== undefined) {
      const buildingId = dto.buildingId ?? room.buildingId;
      const roomNumber = dto.roomNumber ?? room.roomNumber;
      const floor = dto.floor ?? room.floor;

      // 验证楼栋是否存在
      if (dto.buildingId && dto.buildingId !== room.buildingId) {
        const building = await this.prisma.building.findUnique({
          where: { id: dto.buildingId },
        });
        if (!building) {
          throw new BadRequestException('楼栋不存在');
        }
      }

      // 检查唯一性（排除自身）
      const existingRoom = await this.prisma.room.findFirst({
        where: {
          buildingId,
          floor,
          roomNumber,
          NOT: { id },
        },
      });

      if (existingRoom) {
        throw new ConflictException('该楼栋下该楼层的房号已存在');
      }
    }

    // 3. 房态流转校验（若 status / cleanStatus 有变化）
    const targetStatus = dto.status ?? room.status;
    const targetCleanStatus = dto.cleanStatus ?? room.cleanStatus;
    await this.assertTransitionAllowed(room, targetStatus, targetCleanStatus);

    // 4. 更新（乐观锁：提供 version 时校验；每次成功更新 version 递增）
    const { version: expectedVersion, ...fields } = dto;
    const data = { ...fields, version: { increment: 1 } };

    if (expectedVersion !== undefined) {
      const result = await this.prisma.room.updateMany({
        where: { id, version: expectedVersion },
        data,
      });

      if (result.count === 0) {
        throw new ConflictException(VERSION_CONFLICT_MESSAGE);
      }

      return this.prisma.room.findUniqueOrThrow({ where: { id } });
    }

    return this.prisma.room.update({ where: { id }, data });
  }

  /**
   * 房态流转校验（docs/04-状态机.md §1.3-1.4）
   * - 仅允许流转表中的组合；非法流转 400
   * - 前置条件：RESERVED 需草稿合同；RESERVED→OCCUPIED 需合同起始日已到；
   *   VACANT+PENDING_CLEAN 需退租记录；MAINTENANCE 需报修工单
   */
  private async assertTransitionAllowed(
    room: { id: string; status: string; cleanStatus: string },
    targetStatus: string,
    targetCleanStatus: string,
  ) {
    const from = `${room.status}+${room.cleanStatus}`;
    const to = `${targetStatus}+${targetCleanStatus}`;

    if (from === to) return;

    const allowed = ALLOWED_ROOM_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`不允许的房态流转：${from} → ${to}`);
    }

    if (to === 'RESERVED+CLEAN') {
      const draftContract = await this.prisma.contract.findFirst({
        where: { roomId: room.id, status: 'DRAFT' },
      });
      if (!draftContract) {
        throw new BadRequestException('流转前置条件不满足：该房间没有草稿合同');
      }
    }

    if (from === 'RESERVED+CLEAN' && to === 'OCCUPIED+CLEAN') {
      const contract = await this.prisma.contract.findFirst({
        where: {
          roomId: room.id,
          status: { in: ['DRAFT', 'ACTIVE'] },
          startDate: { lte: new Date() },
        },
      });
      if (!contract) {
        throw new BadRequestException('流转前置条件不满足：合同起始日期未到');
      }
    }

    if (to === 'VACANT+PENDING_CLEAN') {
      const checkout = await this.prisma.checkoutRecord.findFirst({
        where: { roomId: room.id },
      });
      if (!checkout) {
        throw new BadRequestException('流转前置条件不满足：该房间没有退租记录');
      }
    }

    if (to === 'MAINTENANCE+CLEAN') {
      const maintenance = await this.prisma.maintenanceRequest.findFirst({
        where: { roomId: room.id },
      });
      if (!maintenance) {
        throw new BadRequestException('流转前置条件不满足：该房间没有报修工单');
      }
    }
  }

  /**
   * 房态流转（乐观锁：version 必填；冲突 409）
   */
  async updateStatus(id: string, dto: UpdateRoomStatusDto) {
    const room = await this.prisma.room.findUnique({ where: { id } });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    if (dto.status === undefined && dto.cleanStatus === undefined) {
      throw new BadRequestException('请提供 status 或 cleanStatus');
    }

    const targetStatus = dto.status ?? room.status;
    const targetCleanStatus = dto.cleanStatus ?? room.cleanStatus;

    await this.assertTransitionAllowed(room, targetStatus, targetCleanStatus);

    const result = await this.prisma.room.updateMany({
      where: { id, version: dto.version },
      data: {
        status: targetStatus,
        cleanStatus: targetCleanStatus,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new ConflictException(VERSION_CONFLICT_MESSAGE);
    }

    return this.prisma.room.findUniqueOrThrow({ where: { id } });
  }

  async remove(id: string) {
    // 1. 检查房源是否存在
    const room = await this.prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    // 2. 关联数据检查（合同/水表/报修/退租/照片），有则拒绝删除（T139）
    const [contracts, meters, maintenanceRequests, checkoutRecords, photos] =
      await Promise.all([
        this.prisma.contract.count({ where: { roomId: id } }),
        this.prisma.meter.count({ where: { roomId: id } }),
        this.prisma.maintenanceRequest.count({ where: { roomId: id } }),
        this.prisma.checkoutRecord.count({ where: { roomId: id } }),
        this.prisma.roomPhoto.count({ where: { roomId: id } }),
      ]);

    const relatedCount =
      contracts + meters + maintenanceRequests + checkoutRecords + photos;

    if (relatedCount > 0) {
      throw new BadRequestException(
        '该房间存在关联数据（合同/水表/报修/退租/照片），不能删除',
      );
    }

    // 3. 硬删除
    await this.prisma.room.delete({
      where: { id },
    });

    return { message: '房源已删除' };
  }
}
