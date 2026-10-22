import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto.js';
import { MarkCleanDto } from './dto/mark-clean.dto.js';
import { QueryRoomsDto } from './dto/query-rooms.dto.js';
import { MAX_ROOM_PHOTOS, type RoomPhotoDto } from './dto/room-photo.dto.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    // 3. 创建房源（照片随房源同事务嵌套写入，避免出现半套记录）
    const photos = this.buildRoomPhotoRows(dto.photos ?? []);
    return this.prisma.room.create({
      data: {
        roomNumber: dto.roomNumber,
        buildingId: dto.buildingId,
        floor: dto.floor,
        roomType: dto.roomType,
        area: dto.area,
        facilities: dto.facilities as Prisma.InputJsonValue,
        description: dto.description,
        status: 'VACANT', // 默认空闲
        cleanStatus: 'CLEAN', // 默认已清洁
        ...(photos.length > 0 ? { photos: { create: photos } } : {}),
      },
      include: {
        photos: {
          select: { id: true, fileUrl: true, thumbnail: true, fileSize: true, sortOrder: true },
          orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
        },
      },
    });
  }

  /** 校验照片上限并生成落库字段；数组顺序即 sortOrder，第一张为封面。 */
  private buildRoomPhotoRows(photos: RoomPhotoDto[]) {
    if (photos.length > MAX_ROOM_PHOTOS) {
      throw new BadRequestException(`房源照片最多 ${MAX_ROOM_PHOTOS} 张`);
    }
    return photos.map((photo, index) => ({
      fileUrl: photo.fileUrl,
      thumbnail: photo.thumbnail ?? null,
      fileSize: photo.fileSize ?? 0,
      sortOrder: index,
    }));
  }

  async findAll(query: QueryRoomsDto, actorRole?: string, actorTenantId?: string) {
    const { page = 1, limit = 20, status, buildingId, cleanStatus } = query;
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: Prisma.RoomWhereInput = {};

    if (buildingId) {
      where.buildingId = buildingId;
    }

    if (actorRole === 'CLEANER') {
      // 保洁仅可见待清洁/清洁中房间（docs/03-权限矩阵.md），列表条件服务端固定，不信任查询参数
      where.status = 'VACANT';
      where.cleanStatus = { in: ['PENDING_CLEAN', 'CLEANING'] };
    } else if (actorRole === 'TENANT') {
      // 租客仅可见自己租住的房间（docs/03-权限矩阵.md），按合同归属过滤，不信任查询参数
      if (actorTenantId) {
        where.contracts = { some: { tenantId: actorTenantId } };
      } else {
        // 未绑定租客档案：无任何可见房源
        where.id = { in: [] };
      }
    } else if (status) {
      where.status = status;
    }

    // 清洁状态过滤（服务端执行，替代前端全量加载后本地过滤）。
    // 保洁角色的 cleanStatus 由上方固定条件决定，此处不覆盖，避免越权放宽。
    if (actorRole !== 'CLEANER' && cleanStatus) {
      where.cleanStatus = cleanStatus;
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
          ...(actorRole === 'ADMIN' ? { contracts: {
            where: { OR: [{ status: 'ACTIVE' as const }, { status: 'DRAFT' as const, room: { status: 'RESERVED' as const } }] },
            orderBy: { createdAt: 'desc' as const }, take: 2,
            select: { id:true,contractNumber:true,status:true,rentAmount:true,startDate:true,endDate:true,
              tenant:{select:{name:true}}, bills:{where:{status:{in:['PENDING' as const,'PARTIAL' as const,'OVERDUE' as const]}},orderBy:{dueDate:'asc' as const},take:1,select:{dueDate:true}} },
          } } : {}),
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

  async findOne(id: string, actorRole?: string, actorTenantId?: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        ...(actorRole === 'ADMIN' ? { photos: {
          select: { id: true, fileUrl: true, thumbnail: true, fileSize: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }], take: 20,
        } } : {}),
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

    // 保洁仅可查看待清洁房间（docs/03-权限矩阵.md）
    if (
      actorRole === 'CLEANER' &&
      !(room.status === 'VACANT' && ['PENDING_CLEAN', 'CLEANING'].includes(room.cleanStatus))
    ) {
      throw new ForbiddenException('保洁仅可查看待清洁房间');
    }

    // 租客仅可查看自己租住的房间（docs/03-权限矩阵.md）
    if (actorRole === 'TENANT') {
      const ownedContract = actorTenantId
        ? await this.prisma.contract.findFirst({
            where: { roomId: id, tenantId: actorTenantId },
            select: { id: true },
          })
        : null;

      if (!ownedContract) {
        throw new ForbiddenException('租客仅可查看自己租住的房间');
      }
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
    const { version: expectedVersion, facilities, photos, ...fields } = dto;
    const data: Prisma.RoomUncheckedUpdateInput = {
      ...fields,
      ...(facilities !== undefined ? { facilities: facilities as Prisma.InputJsonValue } : {}),
      version: { increment: 1 },
    };

    // 提供 photos 时全量替换照片；房源与照片同事务，避免「照片删了但房源没更新」。
    if (photos !== undefined) {
      const photoRows = this.buildRoomPhotoRows(photos);
      const updated = await this.prisma.$transaction(async (tx) => {
        if (expectedVersion !== undefined) {
          const result = await tx.room.updateMany({
            where: { id, version: expectedVersion },
            data,
          });

          if (result.count === 0) {
            throw new ConflictException(VERSION_CONFLICT_MESSAGE);
          }
        } else {
          await tx.room.update({ where: { id }, data });
        }

        await tx.roomPhoto.deleteMany({ where: { roomId: id } });
        if (photoRows.length > 0) {
          await tx.roomPhoto.createMany({
            data: photoRows.map((photo) => ({ ...photo, roomId: id })),
          });
        }

        return tx.room.findUniqueOrThrow({
          where: { id },
          include: {
            photos: {
              select: { id: true, fileUrl: true, thumbnail: true, fileSize: true, sortOrder: true },
              orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
            },
          },
        });
      });

      await this.notifyCleanersIfPendingClean(room, targetStatus, targetCleanStatus);
      return updated;
    }

    if (expectedVersion !== undefined) {
      const result = await this.prisma.room.updateMany({
        where: { id, version: expectedVersion },
        data,
      });

      if (result.count === 0) {
        throw new ConflictException(VERSION_CONFLICT_MESSAGE);
      }

      const updated = await this.prisma.room.findUniqueOrThrow({ where: { id } });
      await this.notifyCleanersIfPendingClean(room, targetStatus, targetCleanStatus);
      return updated;
    }

    const updated = await this.prisma.room.update({ where: { id }, data });
    await this.notifyCleanersIfPendingClean(room, targetStatus, targetCleanStatus);
    return updated;
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

    const updated = await this.prisma.room.findUniqueOrThrow({ where: { id } });
    await this.notifyCleanersIfPendingClean(room, targetStatus, targetCleanStatus);
    return updated;
  }

  /**
   * 标记已清洁（docs/05-接口规范.md §8.2、docs/04-状态机.md §1.3）
   * - 仅「清洁中」房间可标记完成（未接单 400：需先 PENDING_CLEAN → CLEANING）
   * - version 可选（提供则乐观锁冲突 409）
   * - 可选清洁照片写入 RoomPhoto
   */
  async markClean(id: string, dto: MarkCleanDto) {
    const room = await this.prisma.room.findUnique({ where: { id } });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    if (room.status !== 'VACANT' || room.cleanStatus !== 'CLEANING') {
      throw new BadRequestException(
        `仅可对清洁中的房间标记完成（当前 ${room.status}+${room.cleanStatus}，请先接单）`,
      );
    }

    if (dto.version !== undefined) {
      const result = await this.prisma.room.updateMany({
        where: { id, version: dto.version },
        data: { cleanStatus: 'CLEAN', version: { increment: 1 } },
      });

      if (result.count === 0) {
        throw new ConflictException(VERSION_CONFLICT_MESSAGE);
      }
    } else {
      await this.prisma.room.update({
        where: { id },
        data: { cleanStatus: 'CLEAN', version: { increment: 1 } },
      });
    }

    let photo = null;
    if (dto.photo) {
      photo = await this.prisma.roomPhoto.create({
        data: {
          roomId: id,
          fileUrl: dto.photo.fileUrl,
          thumbnail: dto.photo.thumbnail,
          fileSize: dto.photo.fileSize ?? 0,
          sortOrder: 0,
        },
      });
    }

    const updated = await this.prisma.room.findUniqueOrThrow({ where: { id } });
    return { room: updated, photo };
  }

  /** 房间流转至待清洁时通知全部在职保洁（docs/03-权限矩阵.md）；失败不阻断 */
  private async notifyCleanersIfPendingClean(
    previous: { id: string; status: string; cleanStatus: string; roomNumber: string },
    targetStatus: string,
    targetCleanStatus: string,
  ) {
    const wasPending = previous.status === 'VACANT' && previous.cleanStatus === 'PENDING_CLEAN';
    const isPending = targetStatus === 'VACANT' && targetCleanStatus === 'PENDING_CLEAN';
    if (!isPending || wasPending) return;

    const cleaners = await this.prisma.user.findMany({
      where: { role: 'CLEANER', isActive: true },
      select: { id: true },
    });

    for (const cleaner of cleaners) {
      try {
        await this.notificationsService.create({
          userId: cleaner.id,
          title: '待清洁提醒',
          body: `房间 ${previous.roomNumber} 待清洁，请及时处理`,
          priority: NotificationPriority.NORMAL,
          data: { roomId: previous.id },
        });
      } catch {
        // 通知失败不阻断房态流转
      }
    }
  }

  async remove(id: string) {
    // 1. 检查房源是否存在
    const room = await this.prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException('房源不存在');
    }

    // 2. 关联数据检查（合同/水表/报修/退租），有则拒绝删除（T139）
    // 房源照片随房间级联删除，属于房源自身属性，不再作为删除阻断条件（T230）。
    const [contracts, meters, maintenanceRequests, checkoutRecords] =
      await Promise.all([
        this.prisma.contract.count({ where: { roomId: id } }),
        this.prisma.meter.count({ where: { roomId: id } }),
        this.prisma.maintenanceRequest.count({ where: { roomId: id } }),
        this.prisma.checkoutRecord.count({ where: { roomId: id } }),
      ]);

    const relatedCount =
      contracts + meters + maintenanceRequests + checkoutRecords;

    if (relatedCount > 0) {
      throw new BadRequestException(
        '该房间存在关联数据（合同/水表/报修/退租），不能删除',
      );
    }

    // 3. 硬删除
    await this.prisma.room.delete({
      where: { id },
    });

    return { message: '房源已删除' };
  }
}
