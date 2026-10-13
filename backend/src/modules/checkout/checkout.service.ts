import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { UpdateCheckoutDto } from './dto/update-checkout.dto.js';
import { QueryCheckoutsDto } from './dto/query-checkouts.dto.js';

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

    return this.prisma.checkoutRecord.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const record = await this.prisma.checkoutRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('退租记录不存在');
    await this.prisma.checkoutRecord.delete({ where: { id } });
    return { message: '退租记录已删除' };
  }
}
