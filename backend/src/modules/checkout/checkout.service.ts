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

    return this.prisma.checkoutRecord.create({
      data: {
        contractId: dto.contractId,
        roomId: dto.roomId,
        checkoutDate: new Date(dto.checkoutDate),
        totalRefund: dto.totalRefund,
        processedBy: dto.processedBy,
        notes: dto.notes,
      },
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
