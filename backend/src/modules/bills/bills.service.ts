import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBillDto) {
    // 验证合同存在
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
    });

    if (!contract) {
      throw new BadRequestException('合同不存在');
    }

    // 生成账单编号
    const billNumber = `B${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    return this.prisma.bill.create({
      data: {
        contractId: dto.contractId,
        billNumber,
        billType: dto.billType as any,
        period: dto.period,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        snapshot: dto.snapshot || {},
      },
    });
  }

  async findAll(query: QueryBillsDto) {
    const { page = 1, limit = 20, status, billType, contractId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (billType) where.billType = billType;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: {
            include: {
              tenant: { select: { name: true } },
              room: { select: { roomNumber: true } },
            },
          },
        },
      }),
      this.prisma.bill.count({ where }),
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
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: true,
            room: true,
          },
        },
        paymentRecords: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return bill;
  }

  async update(id: string, dto: UpdateBillDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id } });
    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    const updateData: any = {};
    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.paidAmount !== undefined) updateData.paidAmount = dto.paidAmount;
    if (dto.status) updateData.status = dto.status;
    if (dto.dueDate) updateData.dueDate = new Date(dto.dueDate);

    return this.prisma.bill.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id } });
    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    await this.prisma.bill.delete({ where: { id } });
    return { message: '账单已删除' };
  }

  // 租客查看自己的账单
  async findByTenant(tenantId: string, query: QueryBillsDto) {
    const { page = 1, limit = 20, status, billType } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      contract: {
        tenantId,
      },
    };
    if (status) where.status = status;
    if (billType) where.billType = billType;

    const [data, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: {
            include: {
              room: { select: { roomNumber: true } },
            },
          },
        },
      }),
      this.prisma.bill.count({ where }),
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

  // 租客查看单个账单（需验证归属）
  async findOneForTenant(id: string, tenantId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: true,
            room: true,
          },
        },
        paymentRecords: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    // 验证账单是否属于该租客
    if (bill.contract.tenantId !== tenantId) {
      throw new NotFoundException('账单不存在');
    }

    return bill;
  }
}
