import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';

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

  /**
   * 登记收款（docs/04-状态机.md §3.4）
   * - 仅 PENDING / PARTIAL / OVERDUE 可收款（PAID / CANCELLED 不可逆）
   * - 收款金额不可超过未缴金额
   * - 交易号在同一账单内幂等（应用层 + 数据库唯一索引双重保障）
   * - 事务内：写收款记录 + 更新账单已缴金额与状态（PENDING → PARTIAL → PAID）
   */
  async addPayment(billId: string, dto: CreatePaymentDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });

      if (!bill) {
        throw new NotFoundException('账单不存在');
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可收款`);
      }

      const remaining = bill.amount - bill.paidAmount;
      if (dto.amount > remaining) {
        throw new BadRequestException(`收款金额不能超过未缴金额（未缴 ${remaining} 分）`);
      }

      if (dto.transactionNumber) {
        const duplicated = await tx.paymentRecord.findFirst({
          where: { billId, transactionNumber: dto.transactionNumber },
        });

        if (duplicated) {
          throw new ConflictException('该交易号已登记过，请勿重复收款');
        }
      }

      const payment = await tx.paymentRecord.create({
        data: {
          billId,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod as any,
          transactionNumber: dto.transactionNumber,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          confirmedBy: operatorId,
          notes: dto.notes,
        },
      });

      const newPaidAmount = bill.paidAmount + dto.amount;
      const newStatus = newPaidAmount >= bill.amount ? 'PAID' : 'PARTIAL';

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
        },
      });

      return { payment, bill: updatedBill };
    });
  }

  /**
   * 账单收款流水（按收款时间倒序）
   */
  async findPayments(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return this.prisma.paymentRecord.findMany({
      where: { billId },
      orderBy: { paidAt: 'desc' },
    });
  }
}
