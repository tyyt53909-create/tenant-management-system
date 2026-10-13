import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { LateFeeUtil, LateFeeRule } from './utils/late-fee.util.js';

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
        // 管理者可见完整滞纳金记录（含计算过程）
        lateFees: { orderBy: { createdAt: 'desc' } },
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
        // 租客仅可见已确认的最终金额（docs/03-权限矩阵.md：不暴露建议值与计算细节）
        lateFees: {
          where: { confirmedAmount: { not: null } },
          select: { id: true, confirmedAmount: true, confirmedAt: true },
          orderBy: { createdAt: 'desc' },
        },
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

  /**
   * 添加 / 刷新滞纳金（docs/04-状态机.md §3.4、docs/02-数据模型.md §2.9）
   * - 仅对已逾期（到期日 < 今日）且未缴清的账单生效
   * - 不带 confirmedAmount：生成或刷新「建议值」（同一账单只保留一条未确认建议，重复调用不重复建单）
   * - 带 confirmedAmount：管理者确认入账（金额可调整），确认后不可重复确认（409）
   */
  async addLateFee(billId: string, dto: CreateLateFeeDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { contract: { select: { lateFeeRule: true } } },
      });

      if (!bill) {
        throw new NotFoundException('账单不存在');
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可添加滞纳金`);
      }

      const overdueDays = LateFeeUtil.overdueDays(bill.dueDate);
      if (overdueDays <= 0) {
        throw new BadRequestException('账单尚未逾期，无需计算滞纳金');
      }

      const baseAmount = bill.amount - bill.paidAmount;
      if (baseAmount <= 0) {
        throw new BadRequestException('账单已缴清，无需计算滞纳金');
      }

      const result = LateFeeUtil.calculate(
        (bill.contract?.lateFeeRule ?? {}) as LateFeeRule,
        baseAmount,
        overdueDays,
      );

      const calculation = {
        rule: result.rule,
        overdueDays: result.overdueDays,
        effectiveDays: result.effectiveDays,
        baseAmount: result.baseAmount,
        rawAmount: result.rawAmount,
        capped: result.capped,
      };

      const pending = await tx.lateFee.findFirst({
        where: { billId, confirmedAmount: null },
        orderBy: { createdAt: 'desc' },
      });

      if (dto.confirmedAmount !== undefined) {
        // 管理者确认（可调整金额）
        if (!pending) {
          const alreadyConfirmed = await tx.lateFee.findFirst({
            where: { billId, confirmedAmount: { not: null } },
          });
          if (alreadyConfirmed) {
            throw new ConflictException('该账单滞纳金已确认，请勿重复操作');
          }
        }

        const confirmData = {
          suggestedAmount: result.amount,
          overdueDays: result.overdueDays,
          calculation,
          confirmedAmount: dto.confirmedAmount,
          confirmedAt: new Date(),
          confirmedBy: operatorId,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        };

        return pending
          ? tx.lateFee.update({ where: { id: pending.id }, data: confirmData })
          : tx.lateFee.create({ data: { billId, ...confirmData } });
      }

      // 仅生成 / 刷新建议值
      if (pending) {
        return tx.lateFee.update({
          where: { id: pending.id },
          data: {
            suggestedAmount: result.amount,
            overdueDays: result.overdueDays,
            calculation,
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          },
        });
      }

      const alreadyConfirmed = await tx.lateFee.findFirst({
        where: { billId, confirmedAmount: { not: null } },
      });
      if (alreadyConfirmed) {
        throw new ConflictException('该账单滞纳金已确认，请勿重复操作');
      }

      return tx.lateFee.create({
        data: {
          billId,
          suggestedAmount: result.amount,
          overdueDays: result.overdueDays,
          calculation,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    });
  }

  /**
   * 滞纳金记录（含计算过程，仅管理者）
   */
  async findLateFees(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return this.prisma.lateFee.findMany({
      where: { billId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
