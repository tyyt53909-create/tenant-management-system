import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { UpdateCheckoutDto } from './dto/update-checkout.dto.js';
import { QueryCheckoutsDto } from './dto/query-checkouts.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';

const CHECKOUT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待处理',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCheckoutDto) {
    // 验证合同和房源存在
    const [contract, room] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: dto.contractId } }),
      this.prisma.room.findUnique({ where: { id: dto.roomId } }),
    ]);

    if (!contract) throw new BadRequestException('合同不存在');
    if (!room) throw new BadRequestException('房源不存在');

    // 结算明细与主记录必须同时落库，避免出现「有退租记录但无扣款依据」的中间态
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.checkoutRecord.create({
        data: {
          contractId: dto.contractId,
          roomId: dto.roomId,
          checkoutDate: new Date(dto.checkoutDate),
          totalRefund: dto.totalRefund,
          processedBy: dto.processedBy,
          notes: dto.notes,
        },
      });

      if (dto.items && dto.items.length > 0) {
        await tx.checkoutItem.createMany({
          data: dto.items.map((item) => ({
            checkoutId: record.id,
            itemType: item.itemType as any,
            description: item.description,
            amount: item.amount,
            calculation: item.calculation ?? undefined,
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

    const where: any = {};
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

    const where: any = { contract: { tenantId } };
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
    const record = await this.prisma.checkoutRecord.findUnique({
      where: { id },
      include: { contract: { select: { tenantId: true } }, room: true, items: true },
    });

    if (!record || !tenantId || record.contract.tenantId !== tenantId) {
      throw new NotFoundException('退租记录不存在');
    }

    return record;
  }

  async update(id: string, dto: UpdateCheckoutDto) {
    const record = await this.prisma.checkoutRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('退租记录不存在');

    const updateData: any = {};
    if (dto.status) {
      updateData.status = dto.status;
      if (dto.status === 'COMPLETED') updateData.processedAt = new Date();
    }
    if (dto.totalRefund !== undefined) updateData.totalRefund = dto.totalRefund;
    if (dto.notes) updateData.notes = dto.notes;
    if (dto.checkoutDate) updateData.checkoutDate = new Date(dto.checkoutDate);
    if (dto.processedBy) updateData.processedBy = dto.processedBy;

    // 结算明细采用「提供即全量替换」语义，并与主记录同事务，
    // 避免出现「主记录已改但明细还是旧的」不一致状态（T152 反馈的后端缺口）。
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.checkoutRecord.update({ where: { id }, data: updateData });

      if (dto.items !== undefined) {
        await tx.checkoutItem.deleteMany({ where: { checkoutId: id } });

        if (dto.items.length > 0) {
          await tx.checkoutItem.createMany({
            data: dto.items.map((item) => ({
              checkoutId: id,
              itemType: item.itemType as any,
              description: item.description,
              amount: item.amount,
              calculation: item.calculation ?? undefined,
              isAdjusted: item.isAdjusted ?? false,
              adjustReason: item.adjustReason,
            })),
          });
        }
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
    await this.prisma.checkoutRecord.delete({ where: { id } });
    return { message: '退租记录已删除' };
  }

  /**
   * 退租记录 CSV 导出
   */
  async exportCheckouts(query: any) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.contractId) where.contractId = query.contractId;
    if (query.startDate || query.endDate) {
      where.checkoutDate = {};
      if (query.startDate) where.checkoutDate.gte = new Date(query.startDate);
      if (query.endDate) where.checkoutDate.lte = new Date(query.endDate);
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

    const columns: CsvColumn[] = [
      { header: '退租记录ID', key: 'id' },
      { header: '房间号', formatter: (c) => c.room?.roomNumber || '' },
      { header: '租客姓名', formatter: (c) => c.contract?.tenant?.name || '' },
      { header: '租客电话', formatter: (c) => c.contract?.tenant?.phone || '' },
      { header: '合同ID', key: 'contractId' },
      { header: '退租日期', formatter: (c) => (c.checkoutDate ? new Date(c.checkoutDate).toISOString().slice(0, 10) : '') },
      { header: '明细项数', formatter: (c) => c.items?.length || 0 },
      { header: '实退总额(元)', formatter: (c) => centsToYuanString(c.totalRefund) },
      { header: '经办人', key: 'processedBy' },
      { header: '状态', formatter: (c) => CHECKOUT_STATUS_LABEL[c.status] || c.status },
      { header: '创建时间', formatter: (c) => (c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN') : '') },
      { header: '备注', key: 'notes' },
    ];

    return generateCsv(columns, checkouts);
  }

  /**
   * 电子退租结算确认凭单数据聚合
   */
  async getVoucher(id: string) {
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

    const depositAmount = record.contract?.depositAmount ?? 0;
    const deductions = (record.items || []).filter((item) =>
      ['DAMAGE_COMPENSATION', 'CLEANING_FEE', 'OVERDUE_FEE', 'OTHER_DEDUCTION'].includes(item.itemType),
    );
    const refunds = (record.items || []).filter((item) =>
      ['DEPOSIT_REFUND', 'RENT_REFUND', 'OTHER_REFUND'].includes(item.itemType),
    );

    const totalDeduction = deductions.reduce((sum, item) => sum + item.amount, 0);
    const totalRefundItem = refunds.reduce((sum, item) => sum + item.amount, 0);
    const netRefund = record.totalRefund ?? depositAmount + totalRefundItem - totalDeduction;

    return {
      voucherNumber: `VCH-${record.id.slice(0, 8).toUpperCase()}`,
      checkoutId: record.id,
      checkoutDate: record.checkoutDate ? new Date(record.checkoutDate).toISOString().slice(0, 10) : '',
      status: record.status,
      statusLabel: CHECKOUT_STATUS_LABEL[record.status] || record.status,
      roomNumber: record.room?.roomNumber || '',
      buildingName: record.room?.building?.name || '',
      tenantName: record.contract?.tenant?.name || '租客',
      tenantPhone: record.contract?.tenant?.phone || '',
      contractId: record.contractId,
      contractStart: record.contract?.startDate ? new Date(record.contract.startDate).toISOString().slice(0, 10) : '',
      contractEnd: record.contract?.endDate ? new Date(record.contract.endDate).toISOString().slice(0, 10) : '',
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
