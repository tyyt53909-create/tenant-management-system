import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, MaintenanceCategory, MaintenancePriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { CreateMaintenanceMessageDto } from './dto/create-maintenance-message.dto.js';
import {
  DispatchMaintenanceDto,
  StartMaintenanceDto,
  CompleteMaintenanceDto,
  ConfirmMaintenanceDto,
  TransferExpenseDto,
} from './dto/work-order-actions.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import {
  getStaffBuildingScope,
  assertStaffBuildingAccess,
} from '../../common/utils/building-scope.util.js';
import {
  calculateMaintenanceSla,
  evaluateSlaStatus,
} from './maintenance-sla.util.js';
import {
  isMaintenanceTransitionAllowed,
  maintenanceTransitionNeedsAssignee,
  maintenanceTransitionSetsResolvedAt,
} from './maintenance-transitions.js';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateMaintenanceDto,
    user: { userId: string; role: string; tenantId?: string },
  ) {
    let roomId = dto.roomId;
    let tenantId = dto.tenantId;

    if (user.role === 'TENANT') {
      if (!user.tenantId) {
        throw new BadRequestException('租客账号未绑定租客档案，请联系管理员');
      }

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

    const [room, tenant] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: roomId } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    ]);

    if (!room) throw new BadRequestException('房源不存在');
    if (!tenant) throw new BadRequestException('租客不存在');

    if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, room.buildingId);
    }

    const photos = (dto.photos ?? []).filter((p) => typeof p === 'string' && p.trim());
    const priority = (dto.priority as MaintenancePriority) || 'NORMAL';
    const now = new Date();
    const { responseDueAt, slaDueAt } = calculateMaintenanceSla(priority, now);

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.maintenanceRequest.create({
        data: {
          roomId,
          tenantId,
          title: dto.title,
          description: dto.description,
          category: dto.category as MaintenanceCategory,
          priority,
          responseDueAt,
          slaDueAt,
          isSlaBreached: false,
        },
      });

      await tx.maintenanceMessage.create({
        data: {
          requestId: request.id,
          type: 'SYSTEM',
          authorId: user.userId,
          authorRole: user.role,
          body: '提交报修',
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
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        photos: true,
        assignedMaintainer: { select: { id: true, email: true, phone: true } },
        expenseBill: { select: { id: true, billNumber: true, status: true, amount: true, dueDate: true } },
      },
    });

    if (!request || request.tenantId !== scope.tenantId) {
      throw new NotFoundException('报修工单不存在');
    }

    return request;
  }

  async findAll(query: QueryMaintenanceDto, operator?: { userId: string; role: string }) {
    const { page = 1, limit = 20, status, roomId, tenantId, buildingId, assignedMaintainerId, isSlaBreached } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MaintenanceRequestWhereInput = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (tenantId) where.tenantId = tenantId;
    if (assignedMaintainerId) where.assignedMaintainerId = assignedMaintainerId;
    if (isSlaBreached !== undefined) where.isSlaBreached = isSlaBreached;

    const roomWhere: Prisma.RoomWhereInput = {};
    if (operator?.role === 'PROPERTY_MANAGER') {
      const allowed = await getStaffBuildingScope(this.prisma, operator);
      if (allowed !== null) {
        roomWhere.buildingId = { in: allowed };
      }
    }

    if (buildingId) {
      roomWhere.buildingId = buildingId;
    }

    if (Object.keys(roomWhere).length > 0) {
      where.room = roomWhere;
    }

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { id: true, roomNumber: true, buildingId: true, building: { select: { id: true, name: true } } } },
          tenant: { select: { id: true, name: true, phone: true } },
          photos: { select: { id: true, fileUrl: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          _count: { select: { photos: true } },
          assignedMaintainer: { select: { id: true, email: true, phone: true } },
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

  async findOne(id: string, operator?: { userId: string; role: string }) {
    if (operator) {
      await this.assertRequestAccess(id, operator as any);
    }
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        room: { include: { building: { select: { id: true, name: true } } } },
        tenant: true,
        photos: true,
        assignedMaintainer: { select: { id: true, email: true, phone: true } },
        expenseBill: { select: { id: true, billNumber: true, status: true, amount: true, dueDate: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    return request;
  }

  /**
   * 维修派工（WRK-02 / T303）
   */
  async dispatch(
    id: string,
    dto: DispatchMaintenanceDto,
    operator: { userId: string; role: string },
  ) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }
    if (['COMPLETED', 'CANCELLED'].includes(request.status)) {
      throw new ConflictException(`工单处于 ${request.status} 终态，不能派工`);
    }

    if (operator.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, request.room.buildingId);
    }

    const maintainer = await this.prisma.user.findUnique({
      where: { id: dto.assignedMaintainerId },
      select: { id: true, email: true, phone: true, role: true, isActive: true },
    });
    if (!maintainer || !['MAINTAINER', 'ADMIN', 'PROPERTY_MANAGER', 'CLEANER'].includes(maintainer.role)) {
      throw new BadRequestException('指派的维修师傅账号不存在或角色不合法');
    }
    if (!maintainer.isActive) {
      throw new BadRequestException('指派的维修师傅账号已停用');
    }

    const assignedTo = dto.assignedTo?.trim() || maintainer.phone || maintainer.email || maintainer.id;
    const now = new Date();
    const firstRespondedAt = request.firstRespondedAt ?? now;

    const slaEvaluation = evaluateSlaStatus({
      priority: request.priority,
      createdAt: request.createdAt,
      responseDueAt: request.responseDueAt,
      slaDueAt: request.slaDueAt,
      firstRespondedAt,
      status: 'ASSIGNED',
      now,
    });

    const isReDispatch = request.status === 'ASSIGNED';
    const events: string[] = [];
    if (!isReDispatch) {
      events.push(`状态 ${request.status} → ASSIGNED`);
    }
    events.push(`派单给维修师傅 ${assignedTo}`);
    if (dto.notes?.trim()) {
      events.push(`备注：${dto.notes.trim()}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: {
          status: 'ASSIGNED',
          assignedMaintainerId: maintainer.id,
          assignedTo,
          assignedAt: now,
          firstRespondedAt,
          ...(slaEvaluation.isBreached
            ? {
                isSlaBreached: true,
                slaBreachType: slaEvaluation.breachType,
                slaBreachedAt: slaEvaluation.breachAt ?? now,
              }
            : {}),
        },
        include: {
          room: true,
          tenant: true,
          photos: true,
          assignedMaintainer: { select: { id: true, email: true, phone: true } },
        },
      });

      await tx.maintenanceMessage.create({
        data: {
          requestId: id,
          type: 'SYSTEM',
          authorId: operator.userId,
          authorRole: operator.role,
          body: events.join('；'),
        },
      });

      return updated;
    });
  }

  /**
   * 维修师傅接单开工（WRK-02 / T303）
   */
  async startWork(
    id: string,
    user: { userId: string; role: string },
    dto?: StartMaintenanceDto,
  ) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    if (user.role === 'MAINTAINER') {
      if (
        request.assignedMaintainerId !== user.userId &&
        request.assignedTo !== user.userId
      ) {
        throw new ForbiddenException('您无权操作非本人承接的工单');
      }
    } else if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, request.room.buildingId);
    }

    if (request.status !== 'ASSIGNED') {
      throw new ConflictException(`仅已派单（ASSIGNED）状态工单可开工，当前状态为 ${request.status}`);
    }

    const events = ['维修师傅已接单开始处理'];
    if (dto?.notes?.trim()) {
      events.push(`备注：${dto.notes.trim()}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
        },
        include: {
          room: true,
          tenant: true,
          photos: true,
        },
      });

      await tx.maintenanceMessage.create({
        data: {
          requestId: id,
          type: 'SYSTEM',
          authorId: user.userId,
          authorRole: user.role,
          body: events.join('；'),
        },
      });

      return updated;
    });
  }

  /**
   * 维修师傅提报完工（WRK-02 / T303）
   */
  async completeWork(
    id: string,
    user: { userId: string; role: string },
    dto: CompleteMaintenanceDto,
  ) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    if (user.role === 'MAINTAINER') {
      if (
        request.assignedMaintainerId !== user.userId &&
        request.assignedTo !== user.userId
      ) {
        throw new ForbiddenException('您无权操作非本人承接的工单');
      }
    } else if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, request.room.buildingId);
    }

    if (request.status !== 'IN_PROGRESS') {
      throw new ConflictException(`仅在修中（IN_PROGRESS）状态工单可提报完工，当前状态为 ${request.status}`);
    }

    const laborCost = Math.max(0, dto.laborCost ?? 0);
    const materialCost = Math.max(0, dto.materialCost ?? 0);
    const totalCost = laborCost + materialCost;
    const tenantFault = Boolean(dto.tenantFault);
    const resolution = dto.resolution.trim();
    if (!resolution) {
      throw new BadRequestException('处理结果说明不能为空');
    }

    const events = [
      `维修师傅提报完工：${resolution}`,
      `工时费: ¥${(laborCost / 100).toFixed(2)}, 材料费: ¥${(materialCost / 100).toFixed(2)}（总计: ¥${(totalCost / 100).toFixed(2)}）`,
    ];
    if (tenantFault) {
      events.push(`判定为租客责任${dto.faultReason ? `（原因：${dto.faultReason}）` : ''}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: {
          status: 'PENDING_CONFIRM',
          resolution,
          laborCost,
          materialCost,
          totalCost,
          tenantFault,
          faultReason: dto.faultReason?.trim() || null,
        },
        include: {
          room: true,
          tenant: true,
          photos: true,
        },
      });

      if (dto.photos?.length) {
        await tx.maintenancePhoto.createMany({
          data: dto.photos.map((fileUrl) => ({
            requestId: id,
            fileUrl,
            fileSize: 0,
          })),
        });
      }

      await tx.maintenanceMessage.create({
        data: {
          requestId: id,
          type: 'SYSTEM',
          authorId: user.userId,
          authorRole: user.role,
          body: events.join('；'),
        },
      });

      return updated;
    });
  }

  /**
   * 验收与确认（WRK-02 / T303）
   */
  async confirmWork(
    id: string,
    user: { userId: string; role: string; tenantId?: string },
    dto: ConfirmMaintenanceDto,
  ) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    if (user.role === 'TENANT') {
      if (!user.tenantId || request.tenantId !== user.tenantId) {
        throw new ForbiddenException('您无权操作非本人报修的工单');
      }
    } else if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, request.room.buildingId);
    }

    if (request.status !== 'PENDING_CONFIRM') {
      throw new ConflictException(`工单当前为 ${request.status} 状态，无需/不能确认`);
    }

    const now = new Date();

    if (dto.accepted) {
      const slaEvaluation = evaluateSlaStatus({
        priority: request.priority,
        createdAt: request.createdAt,
        responseDueAt: request.responseDueAt,
        slaDueAt: request.slaDueAt,
        firstRespondedAt: request.firstRespondedAt,
        status: 'COMPLETED',
        resolvedAt: now,
      });

      const events = ['租客/管理员验收通过，工单已完成'];
      if (dto.feedback?.trim()) events.push(`评价反馈：${dto.feedback.trim()}`);
      if (dto.rating) events.push(`评分：${dto.rating}星`);

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.maintenanceRequest.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            resolvedAt: now,
            ...(slaEvaluation.isBreached
              ? {
                  isSlaBreached: true,
                  slaBreachType: slaEvaluation.breachType,
                  slaBreachedAt: slaEvaluation.breachAt ?? now,
                }
              : {}),
          },
          include: {
            room: true,
            tenant: true,
            photos: true,
          },
        });

        await tx.maintenanceMessage.create({
          data: {
            requestId: id,
            type: 'SYSTEM',
            authorId: user.userId,
            authorRole: user.role,
            body: events.join('；'),
          },
        });

        return updated;
      });
    } else {
      const events = ['验收驳回重修'];
      if (dto.feedback?.trim()) {
        events.push(`驳回原因：${dto.feedback.trim()}`);
      }

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.maintenanceRequest.update({
          where: { id },
          data: {
            status: 'IN_PROGRESS',
          },
          include: {
            room: true,
            tenant: true,
            photos: true,
          },
        });

        await tx.maintenanceMessage.create({
          data: {
            requestId: id,
            type: 'SYSTEM',
            authorId: user.userId,
            authorRole: user.role,
            body: events.join('；'),
          },
        });

        return updated;
      });
    }
  }

  /**
   * 费用转嫁为租客账单（WRK-02 / T303）
   */
  async transferExpense(
    id: string,
    operator: { userId: string; role: string },
    dto?: TransferExpenseDto,
  ) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    if (operator.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, request.room.buildingId);
    }

    if (!request.tenantFault) {
      throw new BadRequestException('该工单未被判定为租客过失责任，不可转嫁费用');
    }
    if (request.totalCost <= 0) {
      throw new BadRequestException('工单维修费用为0，无需转嫁');
    }
    if (request.expenseTransferred) {
      throw new ConflictException('该工单已转嫁生成账单，禁止重复转嫁');
    }

    const contract = await this.prisma.contract.findFirst({
      where: {
        tenantId: request.tenantId,
        roomId: request.roomId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!contract) {
      throw new BadRequestException('未找到对应租约合同，无法生成账单');
    }

    const now = new Date();
    const dueDate = dto?.dueDate
      ? new Date(dto.dueDate)
      : new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const hex = randomBytes(3).toString('hex').toUpperCase();
    const billNumber = `B${Date.now()}${hex}`;
    const dedupKey = `MAINTENANCE:${id}`;

    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          contractId: contract.id,
          billNumber,
          billType: 'MAINTENANCE',
          period,
          amount: request.totalCost,
          paidAmount: 0,
          dueDate,
          status: 'PENDING',
          dedupKey,
          snapshot: {
            maintenanceRequestId: id,
            title: request.title,
            laborCost: request.laborCost,
            materialCost: request.materialCost,
            totalCost: request.totalCost,
            faultReason: request.faultReason,
            notes: dto?.notes || null,
          },
        },
      });

      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: {
          expenseTransferred: true,
          expenseBillId: bill.id,
          expenseTransferredAt: now,
        },
        include: {
          room: true,
          tenant: true,
          expenseBill: true,
        },
      });

      await tx.maintenanceMessage.create({
        data: {
          requestId: id,
          type: 'SYSTEM',
          authorId: operator.userId,
          authorRole: operator.role,
          body: `已将维修费用 ¥${(request.totalCost / 100).toFixed(2)} 转嫁生成租客账单（账单号：${bill.billNumber}，到期日：${dueDate.toISOString().slice(0, 10)}）`,
        },
      });

      return {
        maintenanceRequest: updated,
        bill,
      };
    });
  }

  /**
   * 维修师傅查询指派给本人的工单（WRK-02 / T303）
   */
  async getAssignedWorkOrders(maintainerId: string, query: QueryMaintenanceDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MaintenanceRequestWhereInput = {
      OR: [
        { assignedMaintainerId: maintainerId },
        { assignedTo: maintainerId },
      ],
      ...(status ? { status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { id: true, roomNumber: true, buildingId: true, building: { select: { id: true, name: true } } } },
          tenant: { select: { id: true, name: true, phone: true } },
          photos: { select: { id: true, fileUrl: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          _count: { select: { photos: true } },
        },
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * 获取并同步 SLA 超时/预警工单（WRK-02 / T303）
   */
  async getSlaAlerts(query: QueryMaintenanceDto, operator?: { userId: string; role: string }) {
    const now = new Date();
    const activeRequests = await this.prisma.maintenanceRequest.findMany({
      where: {
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        room: { select: { id: true, roomNumber: true, buildingId: true, building: { select: { id: true, name: true } } } },
        tenant: { select: { id: true, name: true, phone: true } },
        assignedMaintainer: { select: { id: true, email: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const breachedList: any[] = [];
    const updates: Promise<any>[] = [];

    for (const req of activeRequests) {
      if (operator?.role === 'PROPERTY_MANAGER') {
        const allowed = await getStaffBuildingScope(this.prisma, operator);
        if (allowed && !allowed.includes(req.room.buildingId)) {
          continue;
        }
      }

      const evalResult = evaluateSlaStatus({
        priority: req.priority,
        createdAt: req.createdAt,
        responseDueAt: req.responseDueAt,
        slaDueAt: req.slaDueAt,
        firstRespondedAt: req.firstRespondedAt,
        status: req.status,
        now,
      });

      if (evalResult.isBreached || req.isSlaBreached) {
        breachedList.push({
          ...req,
          breachType: evalResult.breachType || req.slaBreachType,
          breachedAt: evalResult.breachAt || req.slaBreachedAt,
        });

        if (!req.isSlaBreached && evalResult.isBreached) {
          updates.push(
            this.prisma.maintenanceRequest.update({
              where: { id: req.id },
              data: {
                isSlaBreached: true,
                slaBreachType: evalResult.breachType,
                slaBreachedAt: evalResult.breachAt ?? now,
              },
            }),
          );
        }
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    return {
      alerts: breachedList,
      total: breachedList.length,
      evaluatedAt: now,
    };
  }

  async update(id: string, dto: UpdateMaintenanceDto, operator?: { userId: string; role: string }) {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    if (operator?.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, operator, request.room.buildingId);
    }

    const statusChanged = dto.status !== undefined && dto.status !== request.status;
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
    if (dto.assignedMaintainerId) {
      updateData.assignedMaintainer = { connect: { id: dto.assignedMaintainerId } };
    }
    if (dto.resolution) {
      updateData.resolution = dto.resolution;
    }
    if (dto.laborCost !== undefined) {
      updateData.laborCost = Math.max(0, dto.laborCost);
    }
    if (dto.materialCost !== undefined) {
      updateData.materialCost = Math.max(0, dto.materialCost);
    }
    if (dto.laborCost !== undefined || dto.materialCost !== undefined) {
      const l = dto.laborCost !== undefined ? dto.laborCost : request.laborCost;
      const m = dto.materialCost !== undefined ? dto.materialCost : request.materialCost;
      updateData.totalCost = Math.max(0, l) + Math.max(0, m);
    }
    if (dto.tenantFault !== undefined) {
      updateData.tenantFault = dto.tenantFault;
    }
    if (dto.faultReason !== undefined) {
      updateData.faultReason = dto.faultReason;
    }

    if (
      (statusChanged && maintenanceTransitionSetsResolvedAt(dto.status!)) ||
      (!statusChanged && request.status === 'COMPLETED' && dto.resolution !== undefined)
    ) {
      updateData.resolvedAt = new Date();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceRequest.update({
        where: { id },
        data: updateData,
      });

      const events: string[] = [];
      if (statusChanged) events.push(`状态 ${request.status} → ${updated.status}`);
      if (dto.assignedTo) events.push(`派单给 ${dto.assignedTo}`);
      if (dto.resolution) events.push('填写处理结果');
      if (events.length > 0) {
        await tx.maintenanceMessage.create({
          data: {
            requestId: id,
            type: 'SYSTEM',
            authorId: operator?.userId ?? null,
            authorRole: operator?.role ?? 'SYSTEM',
            body: events.join('；'),
          },
        });
      }

      return updated;
    });
  }

  /** 工单时间线：ADMIN / STAFF 任意，TENANT 仅自己的工单。 */
  async findMessages(id: string, user: { userId: string; role: string; tenantId?: string }) {
    await this.assertRequestAccess(id, user);
    const messages = await this.prisma.maintenanceMessage.findMany({
      where: { requestId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { data: messages };
  }

  /** 双方留言：ADMIN / STAFF 任意，TENANT 仅自己的工单。 */
  async addMessage(
    id: string,
    dto: CreateMaintenanceMessageDto,
    user: { userId: string; role: string; tenantId?: string },
  ) {
    await this.assertRequestAccess(id, user);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('留言不能为空');
    return this.prisma.maintenanceMessage.create({
      data: {
        requestId: id,
        type: 'MESSAGE',
        authorId: user.userId,
        authorRole: user.role,
        body,
      },
    });
  }

  private async assertRequestAccess(
    id: string,
    user: { userId: string; role: string; tenantId?: string },
  ): Promise<void> {
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: { room: true },
    });
    if (!request) throw new NotFoundException('报修记录不存在');

    if (user.role === 'TENANT') {
      if (request.tenantId !== user.tenantId) {
        throw new NotFoundException('报修记录不存在');
      }
    } else if (user.role === 'MAINTAINER') {
      if (
        request.assignedMaintainerId !== user.userId &&
        request.assignedTo !== user.userId
      ) {
        throw new ForbiddenException('您无权访问非本人承接的工单');
      }
    } else if (user.role === 'PROPERTY_MANAGER') {
      await assertStaffBuildingAccess(this.prisma, user, request.room.buildingId);
    }
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
