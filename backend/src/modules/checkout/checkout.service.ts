import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, CheckoutItemType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { UpdateCheckoutDto } from './dto/update-checkout.dto.js';
import { QueryCheckoutsDto } from './dto/query-checkouts.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import {
  formatBusinessDate,
  formatBusinessDateTime,
} from '../../common/business-clock/business-clock.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { isDeductionItemType, isRefundItemType } from './checkout-item-types.js';
import { roomUpdateForContractTransition } from '../contracts/contract-transitions.js';
import { settleDepositOnCheckout } from '../deposits/deposit-ledger.util.js';

const CHECKOUT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateCheckoutDto) {
    // 验证合同和房源存在
    const [contract, room] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: dto.contractId } }),
      this.prisma.room.findUnique({ where: { id: dto.roomId } }),
    ]);

    if (!contract) throw new BadRequestException('合同不存在');
    if (!room) throw new BadRequestException('房源不存在');
    if (dto.roomId !== contract.roomId) {
      throw new BadRequestException('退租房间必须与合同房间一致');
    }

    // 结算明细与主记录必须同时落库，避免出现「有退租记录但无扣款依据」的中间态
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.checkoutRecord.create({
        data: {
          contractId: dto.contractId,
          roomId: contract.roomId,
          checkoutDate: new Date(dto.checkoutDate),
          totalRefund: dto.totalRefund,
          processedBy: dto.processedBy,
          notes: dto.notes,
          inspectionId: dto.inspectionId || undefined,
        },
      });

      if (dto.items && dto.items.length > 0) {
        await tx.checkoutItem.createMany({
          data: dto.items.map((item) => ({
            checkoutId: record.id,
            itemType: item.itemType as CheckoutItemType,
            description: item.description,
            amount: item.amount,
            calculation: item.calculation ? (item.calculation as Prisma.InputJsonValue) : undefined,
            isAdjusted: item.isAdjusted ?? false,
            adjustReason: item.adjustReason,
          })),
        });
      }

      return tx.checkoutRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: { items: true },
      });
    });
  }

  async findAll(query: QueryCheckoutsDto) {
    const { page = 1, limit = 20, status, contractId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CheckoutRecordWhereInput = {};
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.checkoutRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: { include: { tenant: { select: { name: true } } } },
          room: { select: { roomNumber: true } },
        },
      }),
      this.prisma.checkoutRecord.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const record = await this.prisma.checkoutRecord.findUnique({
      where: { id },
      include: { contract: true, room: true, items: true },
    });
    if (!record) throw new NotFoundException('退租记录不存在');
    return record;
  }

  /**
   * 租客查看自己的退租记录（docs/03-权限矩阵.md §3.7：租客仅可看自己的记录）
   * 服务端固定按 contract.tenantId 过滤，不信任查询参数
   */
  async findByTenant(tenantId: string, query: QueryCheckoutsDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    // 此处 where 需按可选筛选条件增量赋值；Prisma 的联合过滤类型无法在填入普通 string 后再收窄，故保留 any（OPT-17 已注释豁免）
    const where: any = { contract: scopedWhere(tenantId) };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.checkoutRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: { select: { tenantId: true } },
          room: { select: { roomNumber: true } },
        },
      }),
      this.prisma.checkoutRecord.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** 租客查看单条退租记录（需验证归属，越权按 404 处理） */
  async findOneForTenant(id: string, tenantId?: string) {
    const scope = scopedWhere(tenantId);
    const record = await this.prisma.checkoutRecord.findUnique({
      where: { id },
      include: { contract: { select: { tenantId: true } }, room: true, items: true },
    });

    if (!record || record.contract.tenantId !== scope.tenantId) {
      throw new NotFoundException('退租记录不存在');
    }

    return record;
  }

  async update(id: string, dto: UpdateCheckoutDto) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.checkoutRecord.findUnique({
        where: { id },
        include: {
          items: true,
          contract: { select: { id: true, status: true, roomId: true } },
          room: { select: { id: true, status: true } },
        },
      });
      if (!record) throw new NotFoundException('退租记录不存在');

      // 完成是终态；重复完成幂等返回，避免重复结算押金
      if (record.status === 'COMPLETED' && dto.status === 'COMPLETED') return record;
      if (
        (record.status === 'COMPLETED' || record.status === 'CANCELLED') &&
        (dto.totalRefund !== undefined || dto.items !== undefined || dto.checkoutDate !== undefined)
      ) {
        throw new ConflictException('已完成或已取消的退租单不能改财务字段');
      }

      if (dto.status && dto.status !== record.status) {
        const allowed: Record<string, readonly string[]> = {
          DRAFT: ['PENDING', 'COMPLETED', 'CANCELLED'],
          PENDING: ['DRAFT', 'COMPLETED', 'CANCELLED'],
          COMPLETED: [],
          CANCELLED: [],
        };
        if (!allowed[record.status]?.includes(dto.status)) {
          throw new ConflictException(`退租单状态不允许从 ${record.status} 变更为 ${dto.status}`);
        }
      }

      const updateData: Prisma.CheckoutRecordUpdateInput = {};
      if (dto.status) {
        updateData.status = dto.status;
        if (dto.status === 'COMPLETED') updateData.processedAt = new Date();
      }
      if (dto.totalRefund !== undefined) updateData.totalRefund = dto.totalRefund;
      if (dto.notes) updateData.notes = dto.notes;
      if (dto.checkoutDate) updateData.checkoutDate = new Date(dto.checkoutDate);
      if (dto.processedBy) updateData.processedBy = dto.processedBy;

      const updated = await tx.checkoutRecord.update({ where: { id }, data: updateData });

      if (dto.items !== undefined) {
        await tx.checkoutItem.deleteMany({ where: { checkoutId: id } });
        if (dto.items.length > 0) {
          await tx.checkoutItem.createMany({
            data: dto.items.map((item) => ({
              checkoutId: id,
              itemType: item.itemType as CheckoutItemType,
              description: item.description,
              amount: item.amount,
              calculation: item.calculation ? (item.calculation as Prisma.InputJsonValue) : undefined,
              isAdjusted: item.isAdjusted ?? false,
              adjustReason: item.adjustReason,
            })),
          });
        }
      }

      const items = dto.items ?? record.items;
      const totalRefund = dto.totalRefund ?? record.totalRefund;

      if (dto.status === 'COMPLETED') {
        if (items.length === 0) {
          throw new BadRequestException('完成退租前必须提供结算明细');
        }

        // 结算等式：退款项 - 扣款项 === 实退净额。
        // 仅含扣款项的旧数据（历史 UI 允许只填扣款）不做等式校验，避免阻断存量流程。
        const hasRefundItems = items.some((item) => isRefundItemType(item.itemType));
        if (hasRefundItems) {
          const refundTotal = items
            .filter((item) => isRefundItemType(item.itemType))
            .reduce((sum, item) => sum + item.amount, 0);
          const deductionTotal = items
            .filter((item) => isDeductionItemType(item.itemType))
            .reduce((sum, item) => sum + item.amount, 0);
          if (refundTotal - deductionTotal !== totalRefund) {
            throw new BadRequestException(
              `结算等式不成立：退款 ${refundTotal} - 扣款 ${deductionTotal} ≠ 实退 ${totalRefund}`,
            );
          }
        }

        // 押金台账一次性结清：扣除 + 退还 = 台账余额
        const depositDeduction = items
          .filter((item) => item.itemType === 'DEPOSIT_DEDUCTION')
          .reduce((sum, item) => sum + item.amount, 0);
        // 押金退款项是「应退押金总额」，实际现金退还 = 应退 - 押金扣除
        const depositRefundGross = items
          .filter((item) => item.itemType === 'DEPOSIT_REFUND')
          .reduce((sum, item) => sum + item.amount, 0);
        if (depositRefundGross < depositDeduction) {
          throw new BadRequestException('押金退还小于押金扣除，不能把差额夹成 0');
        }
        const depositRefund = depositRefundGross - depositDeduction;
        try {
          await settleDepositOnCheckout(tx, {
            contractId: record.contractId,
            deductions: depositDeduction,
            refundAmount: depositRefund,
            operatorId: dto.processedBy ?? record.processedBy,
            checkoutId: id,
          });
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }

        // 合同终止 + 房间退出占用（与合同状态机共用规则）
        if (record.contract.status === 'ACTIVE' || record.contract.status === 'EXPIRED') {
          const fromStatus = record.contract.status;
          await tx.contract.update({
            where: { id: record.contractId },
            data: { status: 'TERMINATED' },
          });
          const successor = await tx.contract.findFirst({
            where: {
              roomId: record.contract.roomId,
              id: { not: record.contractId },
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          if (!successor) {
            const room = await tx.room.findUnique({
              where: { id: record.contract.roomId },
              select: { status: true, buildingId: true },
            });
            if (room) {
              const roomUpdate = roomUpdateForContractTransition(room, fromStatus, 'TERMINATED');
              if (roomUpdate) {
                await tx.room.update({ where: { id: record.contract.roomId }, data: roomUpdate });

                // WRK-03 / T304：退租完成自动生成保洁任务工单
                if (tx.cleaningTask) {
                  const existingTask = await tx.cleaningTask.findFirst({
                    where: {
                      roomId: record.contract.roomId,
                      status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] },
                    },
                  });
                  if (!existingTask) {
                    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                    const randomHexStr = Math.random().toString(16).slice(2, 8).toUpperCase();
                    await tx.cleaningTask.create({
                      data: {
                        taskNumber: `CL-${todayStr}-${randomHexStr}`,
                        buildingId: room.buildingId,
                        roomId: record.contract.roomId,
                        type: 'CHECKOUT',
                        status: 'PENDING',
                        source: 'CHECKOUT_AUTO',
                        sourceId: record.id,
                        notes: `退租记录 ${record.id} 自动生成保洁任务`,
                      },
                    });
                  }
                }
              }
            }
          }
        } else if (record.contract.status !== 'TERMINATED') {
          throw new ConflictException(`合同当前状态为 ${record.contract.status}，不能完成退租`);
        }

        // R09：业务交易内记录真实退租完成前后值
        await this.auditLog?.recordEvent({
          tx,
          action: 'CHECKOUT_COMPLETE',
          entityType: 'CheckoutRecord',
          entityId: id,
          actorId: dto.processedBy ?? record.processedBy,
          before: {
            checkoutStatus: record.status,
            contractStatus: record.contract.status,
            totalRefund: record.totalRefund,
          },
          after: {
            checkoutStatus: 'COMPLETED',
            contractStatus: 'TERMINATED',
            totalRefund,
            depositDeduction,
            depositRefund,
          },
          reason: (dto.notes ?? record.notes) || undefined,
          context: {
            contractId: record.contractId,
            roomId: record.roomId,
          },
        });
      }

      return tx.checkoutRecord.findUniqueOrThrow({
        where: { id: updated.id },
        include: { items: true },
      });
    });
  }

  async remove(id: string) {
    const record = await this.prisma.checkoutRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('退租记录不存在');

    // FIN-06 / T265：退租结算单是财务凭证，只能取消（status=CANCELLED），不得硬删除。
    throw new ConflictException('退租结算单是财务凭证，只能取消（PATCH status=CANCELLED），不能删除');
  }

  /**
   * 退租记录 CSV 导出
   */
  async exportCheckouts(query: Partial<QueryCheckoutsDto>) {
    const where: Prisma.CheckoutRecordWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.contractId) where.contractId = query.contractId;
    if (query.startDate || query.endDate) {
      where.checkoutDate = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const checkouts = await this.prisma.checkoutRecord.findMany({
      where,
      include: {
        room: { select: { roomNumber: true } },
        contract: {
          include: {
            tenant: { select: { name: true, phone: true } },
          },
        },
        items: true,
      },
      orderBy: [{ checkoutDate: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
    });

    type ExportCheckoutItem = (typeof checkouts)[number];
    const columns: CsvColumn<ExportCheckoutItem>[] = [
      { header: '退租记录ID', key: 'id' },
      { header: '房间号', formatter: (c) => c.room?.roomNumber || '' },
      { header: '租客姓名', formatter: (c) => c.contract?.tenant?.name || '' },
      { header: '租客电话', formatter: (c) => c.contract?.tenant?.phone || '' },
      { header: '合同ID', key: 'contractId' },
      {
        header: '退租日期',
        formatter: (c) => (c.checkoutDate ? formatBusinessDate(new Date(c.checkoutDate)) : ''),
      },
      { header: '明细项数', formatter: (c) => c.items?.length || 0 },
      { header: '实退总额(元)', formatter: (c) => centsToYuanString(c.totalRefund) },
      { header: '经办人', key: 'processedBy' },
      { header: '状态', formatter: (c) => CHECKOUT_STATUS_LABEL[c.status] || c.status },
      {
        header: '创建时间',
        formatter: (c) => (c.createdAt ? formatBusinessDateTime(new Date(c.createdAt)) : ''),
      },
      { header: '备注', key: 'notes' },
    ];

    return generateCsv(columns, checkouts);
  }

  /**
   * 电子退租结算确认凭单数据聚合（支持租客归属防越权）
   */
  async getVoucher(id: string, tenantId?: string) {
    const record = await this.prisma.checkoutRecord.findUnique({
      where: { id },
      include: {
        room: {
          include: { building: true },
        },
        contract: {
          include: { tenant: true },
        },
        items: true,
      },
    });

    if (!record) {
      throw new NotFoundException('退租记录不存在');
    }

    // tenantId === undefined 才代表「管理员视图」；空串是「租客但无档案」，必须走比对（T209）
    if (tenantId !== undefined && (!record.contract || record.contract.tenantId !== tenantId)) {
      throw new NotFoundException('退租记录不存在');
    }

    const depositAmount = record.contract?.depositAmount ?? 0;
    // 类别分组集中在 checkout-item-types.ts（与 Prisma 枚举对齐，T207）
    const deductions = (record.items || []).filter((item) => isDeductionItemType(item.itemType));
    const refunds = (record.items || []).filter((item) => isRefundItemType(item.itemType));

    const totalDeduction = deductions.reduce((sum, item) => sum + item.amount, 0);
    const totalRefundItem = refunds.reduce((sum, item) => sum + item.amount, 0);
    const netRefund = record.totalRefund ?? depositAmount + totalRefundItem - totalDeduction;

    return {
      voucherNumber: `VCH-${record.id.slice(0, 8).toUpperCase()}`,
      checkoutId: record.id,
      checkoutDate: record.checkoutDate ? formatBusinessDate(new Date(record.checkoutDate)) : '',
      status: record.status,
      statusLabel: CHECKOUT_STATUS_LABEL[record.status] || record.status,
      roomNumber: record.room?.roomNumber || '',
      buildingName: record.room?.building?.name || '',
      tenantName: record.contract?.tenant?.name || '租客',
      tenantPhone: record.contract?.tenant?.phone || '',
      contractId: record.contractId,
      contractStart: record.contract?.startDate ? formatBusinessDate(new Date(record.contract.startDate)) : '',
      contractEnd: record.contract?.endDate ? formatBusinessDate(new Date(record.contract.endDate)) : '',
      depositAmount,
      totalDeduction,
      totalRefundItem,
      netRefund,
      netRefundInChinese: centsToChineseRMB(netRefund),
      items: (record.items || []).map((item) => ({
        id: item.id,
        itemType: item.itemType,
        description: item.description,
        amount: item.amount,
        amountYuan: centsToYuanString(item.amount),
        isAdjusted: item.isAdjusted,
        adjustReason: item.adjustReason,
      })),
      processedBy: record.processedBy,
      notes: record.notes,
      issuedAt: new Date(),
    };
  }
}
