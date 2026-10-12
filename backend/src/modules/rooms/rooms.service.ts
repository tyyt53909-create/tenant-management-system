import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { QueryRoomsDto } from './dto/query-rooms.dto.js';

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

    // 3. 更新房源
    return this.prisma.room.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    // 1. 检查房源是否存在
    const room = await this.prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    // 2. 硬删除（因为 Schema 中没有 isDeleted 字段）
    // 注意：实际生产环境应该检查是否有关联的合同等数据
    await this.prisma.room.delete({
      where: { id },
    });

    return { message: '房源已删除' };
  }
}
