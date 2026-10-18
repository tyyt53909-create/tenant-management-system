import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma, MaintenanceCategory, MaintenancePriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import {
  isMaintenanceTransitionAllowed,
  maintenanceTransitionNeedsAssignee,
  maintenanceTransitionSetsResolvedAt,
} from './maintenance-transitions.js';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMaintenanceDto, user: { userId: string; role: string; tenantId?: string }) {
    let roomId = dto.roomId;
    let tenantId = dto.tenantId;

    if (user.role === 'TENANT') {
      // 租客自助报修：租客身份与房间均由服务端推导（忽略请求体中的 ID，防伪造）
      if (!user.tenantId) {
        throw new BadRequestException('租客账号未绑定租客档案，请联系管理员');
      }

      // 统一走范围助手：tenantId 为空时直接 403，不让 Prisma 把 undefined 当作「不过滤」
      const contract = await this.prisma.contract.findFirst({
        where: scopedWhere(user.tenantId, { status: 'ACTIVE' as const }),
      });

      if (!contract) {
        throw new BadRequestException('未找到生效合同，无法提交报修');
      }

      tenantId = user.tenantId;
      roomId = contract.roomId;
    }

    if (!roomId || !tenantId) {
      throw new BadRequestException('管理员需指定 roomId 与 tenantId');
    }

    // 验证房源和租客存在
    const [room, tenant] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: roomId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);

    if (!room) throw new BadRequestException('房源不存在');
    if (!tenant) throw new BadRequestException('租客不存在');

    // 照片与工单同事务落库，避免「有照片记录但无工单」的中间态。
    // MaintenancePhoto.fileSize 为必填：优先取上报的大小，取不到以 0 占位
    // （该字段仅用于展示，不参与业务判断）。
    // 注意：全局 ValidationPipe 开启了 forbidNonWhitelisted，请求体不得携带
    // DTO 未声明的字段，因此这里只接受 photos（路径），大小由上传接口自行记录。
    const photos = (dto.photos ?? []).filter((p) => typeof p === 'string' && p.trim());

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.maintenanceRequest.create({
        data: {
          roomId,
          tenantId,
          title: dto.title,
          description: dto.description,
          category: dto.category as MaintenanceCategory,
          priority: (dto.priority as MaintenancePriority) || 'NORMAL',
        },
      });

      if (photos.length > 0) {
        await tx.maintenancePhoto.createMany({
          data: photos.map((fileUrl) => ({
            requestId: request.id,
            fileUrl,
            fileSize: 0,
          })),
        });
      }

      return tx.maintenanceRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { photos: true },
      });
    });
  }

  /** 租客查看自己的报修工单（分页倒序） */
  async findByTenant(tenantId: string, query: QueryMaintenanceDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    // 此处 where 需按可选筛选条件增量赋值；Prisma 的联合过滤类型无法在填入普通 string 后再收窄，故保留 any（OPT-17 已注释豁免）
    const where: any = scopedWhere(tenantId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** 租客查询单条工单（仅限自己的） */
  async findOneForTenant(id: string, tenantId: string) {
    const scope = scopedWhere(tenantId);
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id }, include: { photos: true } });

    if (!request || request.tenantId !== scope.tenantId) {
      throw new NotFoundException('报修工单不存在');
    }

    return request;
  }

  async findAll(query: QueryMaintenanceDto) {
    const { page = 1, limit = 20, status, roomId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MaintenanceRequestWhereInput = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { name: true } },
          photos: { select: { id: true, fileUrl: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          _count: { select: { photos: true } },
        },
      }),
      this.prisma.maintenanceRequest.count({ where }),
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
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        photos: true,
      },
    });

    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    return request;
  }

  async update(id: string, dto: UpdateMaintenanceDto) {
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    const statusChanged = dto.status !== undefined && dto.status !== request.status;
    // 状态流转校验（docs/04 §4.3）。原先直接写任意 status：COMPLETED 可退回 SUBMITTED、
    // 可直接跳到 ASSIGNED 而不填 assignedTo，resolution 还会在未完成时就写 resolvedAt（T207）。
    if (statusChanged && !isMaintenanceTransitionAllowed(request.status, dto.status!)) {
      throw new ConflictException(
        `工单状态不允许从 ${request.status ?? '未知'} 变更为 ${dto.status}（合法流转见 docs/04-状态机.md §4.3）`,
      );
    }
    if (
      dto.status !== undefined &&
      maintenanceTransitionNeedsAssignee(dto.status) &&
      !dto.assignedTo &&
      !request.assignedTo
    ) {
      throw new BadRequestException('派单必须指定 assignedTo');
    }

    const updateData: Prisma.MaintenanceRequestUpdateInput = {};
    if (dto.status) updateData.status = dto.status;
    if (dto.assignedTo) {
      updateData.assignedTo = dto.assignedTo;
      updateData.assignedAt = new Date();
    }
    if (dto.resolution) {
      updateData.resolution = dto.resolution;
    }
    // resolvedAt 只在「确认完成」时写；未完成就填 resolution 不应留下已完成的痕迹
    if (
      (statusChanged && maintenanceTransitionSetsResolvedAt(dto.status!)) ||
      (!statusChanged && request.status === 'COMPLETED' && dto.resolution !== undefined)
    ) {
      updateData.resolvedAt = new Date();
    }

    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    await this.prisma.maintenanceRequest.delete({ where: { id } });
    return { message: '报修记录已删除' };
  }
}
