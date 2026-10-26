import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Prisma, InspectionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import {
  CreateInspectionDto,
  InspectionItemDto,
} from './dto/create-inspection.dto.js';
import { UpdateInspectionDto } from './dto/update-inspection.dto.js';
import { QueryInspectionsDto } from './dto/query-inspections.dto.js';
import { ConfirmInspectionDto } from './dto/confirm-inspection.dto.js';

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 获取默认验房项目清单模板（来自设置中心 FIN-11） */
  async getTemplateItems(): Promise<Array<{ name: string; category?: string; quantity: number }>> {
    const items = await this.settings.getValue<Array<{ name: string; category?: string; quantity: number }>>(
      'leasing.defaultInspectionItems',
    );
    return items || [];
  }

  async create(dto: CreateInspectionDto, operatorId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
      include: {
        room: true,
        tenant: true,
      },
    });

    if (!contract) {
      throw new BadRequestException('关联合同不存在');
    }

    // 若未传入物品列表，自动基于系统默认模版填充
    let itemsToCreate: InspectionItemDto[] = dto.items || [];
    if (itemsToCreate.length === 0) {
      const templateItems = await this.getTemplateItems();
      itemsToCreate = templateItems.map((item) => ({
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        status: 'INTACT',
        repairCost: 0,
      }));
    }

    const inspectedAt = dto.inspectedAt ? new Date(dto.inspectedAt) : new Date();

    const inspection = await this.prisma.roomInspection.create({
      data: {
        type: dto.type,
        status: 'PENDING_CONFIRM',
        contractId: contract.id,
        roomId: contract.roomId,
        tenantId: contract.tenantId,
        inspectorName: dto.inspectorName,
        inspectorPhone: dto.inspectorPhone,
        meterReadings: dto.meterReadings as Prisma.InputJsonValue,
        photos: dto.photos as Prisma.InputJsonValue,
        overallNotes: dto.overallNotes,
        inspectedAt,
        createdBy: operatorId,
        items: {
          create: itemsToCreate.map((item) => ({
            name: item.name,
            category: item.category,
            quantity: item.quantity ?? 1,
            status: item.status ?? 'INTACT',
            damageDescription: item.damageDescription,
            repairCost: item.repairCost ?? 0,
            photos: item.photos as Prisma.InputJsonValue,
            notes: item.notes,
          })),
        },
      },
      include: {
        items: true,
        contract: { select: { contractNumber: true } },
        room: { select: { roomNumber: true } },
        tenant: { select: { name: true, phone: true } },
      },
    });

    // 通知租客进行验房确认
    if (contract.tenant.userId) {
      const typeLabel = dto.type === 'CHECK_IN' ? '入住交付' : '退租交接';
      await this.notifications
        .create({
          userId: contract.tenant.userId,
          title: `房屋${typeLabel}验房单待确认`,
          body: `您的房屋（${contract.room.roomNumber}室）${typeLabel}验房单已生成，请核对设施物品并在线确认。`,
          priority: 'NORMAL' as any,
          data: { inspectionId: inspection.id, type: dto.type },
        })
        .catch((err) => {
          this.logger.error(`通知租客验房确认失败: ${err.message}`);
        });
    }

    return inspection;
  }

  async findAll(query: QueryInspectionsDto) {
    const { page = 1, limit = 20, type, status, contractId, roomId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.RoomInspectionWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;
    if (roomId) where.roomId = roomId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.roomInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { inspectedAt: 'desc' },
        include: {
          room: { select: { roomNumber: true, roomType: true } },
          tenant: { select: { name: true, phone: true } },
          contract: { select: { contractNumber: true } },
          items: true,
        },
      }),
      this.prisma.roomInspection.count({ where }),
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

  async findByTenant(tenantId: string, query: QueryInspectionsDto) {
    const { page = 1, limit = 20, type, status, contractId } = query;
    const skip = (page - 1) * limit;

    const where: any = scopedWhere(tenantId);
    if (type) where.type = type;
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.roomInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { inspectedAt: 'desc' },
        include: {
          room: { select: { roomNumber: true, roomType: true } },
          contract: { select: { contractNumber: true } },
          items: true,
        },
      }),
      this.prisma.roomInspection.count({ where }),
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
    const inspection = await this.prisma.roomInspection.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        contract: true,
        items: true,
        checkoutRecords: true,
      },
    });

    if (!inspection) {
      throw new NotFoundException('验房单不存在');
    }

    return inspection;
  }

  async findOneForTenant(id: string, tenantId?: string) {
    const scope = scopedWhere(tenantId);
    const inspection = await this.prisma.roomInspection.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        contract: true,
        items: true,
      },
    });

    if (!inspection || inspection.tenantId !== scope.tenantId) {
      throw new NotFoundException('验房单不存在');
    }

    return inspection;
  }

  async update(id: string, dto: UpdateInspectionDto) {
    const inspection = await this.findOne(id);

    if (inspection.status === 'CONFIRMED' && dto.status !== 'CONFIRMED') {
      throw new ConflictException('已确认生效的验房单不可修改');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items !== undefined) {
        await tx.inspectionItem.deleteMany({ where: { inspectionId: id } });
        if (dto.items.length > 0) {
          await tx.inspectionItem.createMany({
            data: dto.items.map((item) => ({
              inspectionId: id,
              name: item.name,
              category: item.category,
              quantity: item.quantity ?? 1,
              status: item.status ?? 'INTACT',
              damageDescription: item.damageDescription,
              repairCost: item.repairCost ?? 0,
              photos: item.photos as Prisma.InputJsonValue,
              notes: item.notes,
            })),
          });
        }
      }

      const updateData: Prisma.RoomInspectionUpdateInput = {};
      if (dto.type) updateData.type = dto.type;
      if (dto.status) updateData.status = dto.status;
      if (dto.inspectorName) updateData.inspectorName = dto.inspectorName;
      if (dto.inspectorPhone !== undefined) updateData.inspectorPhone = dto.inspectorPhone;
      if (dto.inspectedAt) updateData.inspectedAt = new Date(dto.inspectedAt);
      if (dto.meterReadings !== undefined) {
        updateData.meterReadings = dto.meterReadings as Prisma.InputJsonValue;
      }
      if (dto.photos !== undefined) updateData.photos = dto.photos as Prisma.InputJsonValue;
      if (dto.overallNotes !== undefined) updateData.overallNotes = dto.overallNotes;
      if (dto.checkoutRecordId !== undefined) {
        updateData.checkoutRecords = dto.checkoutRecordId
          ? { connect: { id: dto.checkoutRecordId } }
          : undefined;
      }

      return tx.roomInspection.update({
        where: { id },
        data: updateData,
        include: { items: true, room: true, tenant: true },
      });
    });
  }

  async confirm(id: string, dto: ConfirmInspectionDto, tenantId?: string, isTenant = true) {
    const inspection = isTenant
      ? await this.findOneForTenant(id, tenantId)
      : await this.findOne(id);

    if (inspection.status === 'CONFIRMED') {
      return inspection; // 幂等放行
    }

    const agree = dto.agree !== false;
    const targetStatus: InspectionStatus = agree ? 'CONFIRMED' : 'REJECTED';

    const updated = await this.prisma.roomInspection.update({
      where: { id },
      data: {
        status: targetStatus,
        tenantConfirmedAt: agree ? new Date() : null,
        tenantNotes: dto.tenantNotes || inspection.tenantNotes,
        tenantSignature: dto.tenantSignature || inspection.tenantSignature,
      },
      include: { items: true, room: true, tenant: true },
    });

    return updated;
  }

  async remove(id: string) {
    const inspection = await this.findOne(id);
    if (inspection.status === 'CONFIRMED') {
      throw new ConflictException('已确认生效的验房单不可删除');
    }

    await this.prisma.roomInspection.delete({ where: { id } });
    return { success: true, message: '验房单已删除' };
  }
}
