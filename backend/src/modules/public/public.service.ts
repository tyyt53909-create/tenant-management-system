import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryPublicRoomsDto } from './dto/query-public-rooms.dto.js';

/**
 * 公开看房（P1 / T155）
 *
 * 安全红线：本服务**只**返回以下白名单字段，
 * 且列表仅包含可出租房源（VACANT + CLEAN）。
 *
 * ❌ 绝不返回：租客信息（姓名/手机号/证件）、合同与金额、内部备注、
 *    cleanStatus 之外的状态细节、楼栋地址以外的房东元数据。
 *
 * 实现方式：用 Prisma select 显式白名单（而非 findUnique 后裁剪），
 * 从数据源头杜绝字段泄露；配套测试断言响应中不含租客相关键。
 */
const PUBLIC_ROOM_SELECT = {
  id: true,
  roomNumber: true,
  floor: true,
  roomType: true,
  area: true,
  facilities: true,
  description: true,
  building: { select: { name: true, address: true } },
  photos: {
    select: { fileUrl: true, thumbnail: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** 可出租房源列表（VACANT + CLEAN），支持按楼栋/楼层/房型筛选与分页 */
  async listRooms(query: QueryPublicRoomsDto) {
    const { page = 1, limit = 20, buildingId, floor, roomType } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      status: 'VACANT',
      cleanStatus: 'CLEAN',
    };
    if (buildingId) where.buildingId = buildingId;
    if (floor !== undefined) where.floor = floor;
    if (roomType) where.roomType = roomType;

    const [data, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }],
        select: PUBLIC_ROOM_SELECT,
      }),
      this.prisma.room.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** 房源详情；仅可出租房源可见，其余一律 404（不暴露存在性） */
  async getRoom(id: string) {
    const room = await this.prisma.room.findFirst({
      where: { id, status: 'VACANT', cleanStatus: 'CLEAN' },
      select: PUBLIC_ROOM_SELECT,
    });

    if (!room) throw new NotFoundException('房源不存在或暂不可租');
    return room;
  }

  /** 可租楼栋列表（仅返回有可租房源的楼栋名称与地址） */
  async listBuildings() {
    return this.prisma.building.findMany({
      where: {
        isActive: true,
        rooms: { some: { status: 'VACANT', cleanStatus: 'CLEAN' } },
      },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });
  }
}
