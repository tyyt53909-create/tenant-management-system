import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma, MaintenanceCategory, MaintenancePriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { CompleteMaintenanceDto } from './dto/complete-maintenance.dto.js';
import { QueryWorkbenchDto, WorkbenchView } from './dto/query-workbench.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import {
  isMaintenanceTransitionAllowed,
  maintenanceTransitionSetsResolvedAt,
} from './maintenance-transitions.js';

/**
 * 维修工作台投影：只给维修人员看房间、问题与照片，
 * 不返回租客姓名、电话、证件等资料（docs/03 §2.2 数据最小化）。
 */
const WORKBENCH_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  priority: true,
  status: true,
  assignedTo: true,
  assignedAt: true,
  resolvedAt: true,
  resolution: true,
  createdAt: true,
  updatedAt: true,
  room: {
    select: {
      id: true,
      roomNumber: true,
      floor: true,
      building: { select: { name: true } },
    },
  },
  photos: {
    select: { id: true, fileUrl: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.MaintenanceRequestSelect;

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

  /**
   * 维修工作台列表（T225）。
   *
   * - pool：待接单。公共池（assignedTo = null）与直接指派给我的工单；
   * - active：我已接单、处理中或待租客确认；
   * - done：我已完成的工单。
   */
  async findWorkbench(userId: string, query: QueryWorkbenchDto) {
    const { page = 1, limit = 20, view = WorkbenchView.POOL } = query;
    const skip = (page - 1) * limit;

    // 维修人员的范围必须由服务端固定，不能由请求参数放宽。
    const where: Prisma.MaintenanceRequestWhereInput =
      view === WorkbenchView.POOL
        ? {
            status: 'ASSIGNED',
            OR: [{ assignedTo: null }, { assignedTo: userId }],
          }
        : view === WorkbenchView.ACTIVE
          ? {
              assignedTo: userId,
              status: { in: ['IN_PROGRESS', 'PENDING_CONFIRM'] },
            }
          : {
              assignedTo: userId,
              status: 'COMPLETED',
            };

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: WORKBENCH_SELECT,
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** 维修人员查看单条工单：公共池、指派给自己或自己已接的工单。 */
  async findOneForWorker(id: string, userId: string) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: WORKBENCH_SELECT,
    });

    if (!request) {
      throw new NotFoundException('报修工单不存在');
    }

    const isPool = request.status === 'ASSIGNED' && request.assignedTo === null;
    const isMine = request.assignedTo === userId;
    if (!isPool && !isMine) {
      // 不暴露他人工单是否存在
      throw new NotFoundException('报修工单不存在');
    }

    return request;
  }

  /**
   * 接单：ASSIGNED → IN_PROGRESS。公共池先接先得。
   * 使用带状态与指派条件的 updateMany，避免两个维修人员同时接单时后写覆盖。
   */
  async claim(id: string, userId: string) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: { id: true, status: true, assignedTo: true },
    });

    if (!request) {
      throw new NotFoundException('报修工单不存在');
    }
    if (request.status !== 'ASSIGNED') {
      throw new ConflictException('仅可承接待接单的工单');
    }
    if (request.assignedTo && request.assignedTo !== userId) {
      throw new ConflictException('工单已被其他维修人员接单');
    }

    const result = await this.prisma.maintenanceRequest.updateMany({
      where: {
        id,
        status: 'ASSIGNED',
        OR: [{ assignedTo: null }, { assignedTo: userId }],
      },
      data: { status: 'IN_PROGRESS', assignedTo: userId, assignedAt: new Date() },
    });

    if (result.count === 0) {
      throw new ConflictException('工单已被其他维修人员接单，请刷新后重试');
    }

    return this.findOneForWorker(id, userId);
  }

  /** 提交处理结果：IN_PROGRESS → PENDING_CONFIRM，必须填写解决方案。 */
  async complete(id: string, userId: string, dto: CompleteMaintenanceDto) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      select: { id: true, status: true, assignedTo: true },
    });

    if (!request) {
      throw new NotFoundException('报修工单不存在');
    }
    if (request.assignedTo !== userId) {
      throw new ForbiddenException('仅可处理自己接下的工单');
    }
    if (request.status !== 'IN_PROGRESS') {
      throw new ConflictException('仅可提交维修中的工单');
    }

    const resolution = dto.resolution?.trim();
    if (!resolution) {
      throw new BadRequestException('请填写解决方案');
    }

    const result = await this.prisma.maintenanceRequest.updateMany({
      where: { id, status: 'IN_PROGRESS', assignedTo: userId },
      data: { status: 'PENDING_CONFIRM', resolution },
    });

    if (result.count === 0) {
      throw new ConflictException('工单状态已变化，请刷新后重试');
    }

    return this.findOneForWorker(id, userId);
  }

  /** 管理员派单候选人：启用中的维修人员。 */
  async findAssignees() {
    return this.prisma.user.findMany({
      where: { role: 'MAINTENANCE', isActive: true },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 指派对象必须是启用中的维修人员或管理员，避免写入无法登录的账号。 */
  private async assertAssignableUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive || !['MAINTENANCE', 'ADMIN'].includes(user.role)) {
      throw new BadRequestException('指派对象必须是启用中的维修人员');
    }
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

    // T225：ASSIGNED 可以不带 assignedTo（进入公共池）；带值时必须是可登录的维修/管理员账号。
    // 传空字符串表示把已指派工单退回公共池（清空 assignedTo/assignedAt）。
    if (typeof dto.assignedTo === 'string' && dto.assignedTo.trim()) {
      await this.assertAssignableUser(dto.assignedTo);
    }

    const effectiveAssignee =
      dto.assignedTo !== undefined ? dto.assignedTo.trim() : request.assignedTo;
    if (
      statusChanged &&
      ['IN_PROGRESS', 'PENDING_CONFIRM'].includes(dto.status!) &&
      !effectiveAssignee
    ) {
      throw new BadRequestException('进入维修中前必须先指派维修人员，或由维修人员在工作中台接单');
    }

    const updateData: Prisma.MaintenanceRequestUpdateInput = {};
    if (dto.status) updateData.status = dto.status;
    if (dto.assignedTo !== undefined) {
      const assignee = dto.assignedTo.trim();
      updateData.assignedTo = assignee || null;
      updateData.assignedAt = assignee ? new Date() : null;
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
