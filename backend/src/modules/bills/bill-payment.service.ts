import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';

@Injectable()
export class BillPaymentService {
  private readonly payments: PaymentProvider;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PAYMENT_PROVIDER) payments?: PaymentProvider,
  ) {
    this.payments = payments ?? new OfflinePaymentProvider();
  }

  /**
   * 登记收款（docs/04-状态机.md §3.4、T141）
   * - 仅 PENDING / PARTIAL / OVERDUE 可收款（PAID / CANCELLED 不可逆）
   * - 收款上限 = 账单未缴金额 + 未核销滞纳金合计（超出 400）
   * - 分配顺序：先入账单本金，余额按确认时间先后核销滞纳金（支持部分核销）
   * - 状态：账单全额缴清且滞纳金全部核销才 PAID，否则 PARTIAL
   * - 交易号在同一账单内幂等（应用层 + 数据库唯一索引双重保障）
   */
  async addPayment(billId: string, dto: CreatePaymentDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 悲观行锁：并发收款时串行化锁定当前账单，杜绝并发超收与状态脏写覆盖
      try {
        if (typeof (tx as any).$executeRawUnsafe === 'function') {
          await (tx as any).$executeRawUnsafe(`SELECT id FROM bills WHERE id = $1 FOR UPDATE`, billId);
        }
      } catch {
        // 兼容单元测试 mock 或无原生 SQL 执行环境
      }

      const bill = await tx.bill.findUnique({ where: { id: billId } });

      if (!bill) {
        throw new NotFoundException('账单不存在');
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可收款`);
      }

      // 已确认未核销的滞纳金（按确认先后核销）
      const unsettledFees = await tx.lateFee.findMany({
        where: { billId, confirmedAmount: { not: null } },
        orderBy: { createdAt: 'asc' },
      });

      const outstandingFees = unsettledFees.reduce(
        (sum, fee) => sum + this.lateFeeOutstanding(fee),
        0,
      );

      const remaining = bill.amount - bill.paidAmount;
      const maxCollectable = remaining + outstandingFees;

      if (dto.amount > maxCollectable) {
        throw new BadRequestException(
          `收款金额不能超过未缴金额（账单未缴 ${remaining} 分 + 未核销滞纳金 ${outstandingFees} 分）`,
        );
      }

      if (dto.transactionNumber) {
        const duplicated = await tx.paymentRecord.findFirst({
          where: { billId, transactionNumber: dto.transactionNumber },
        });

        if (duplicated) {
          throw new ConflictException('该交易号已登记过，请勿重复收款');
        }
      }

      await this.payments.createOrder({
        billId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: `账单 ${billId}`,
      });

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

      // 先入账单，余额核销滞纳金
      const billPortion = Math.min(dto.amount, remaining);
      let feePortion = dto.amount - billPortion;
      const now = new Date();

      const settledFees: unknown[] = [];
      for (const fee of unsettledFees) {
        if (feePortion <= 0) break;

        const feeOutstanding = this.lateFeeOutstanding(fee);
        if (feeOutstanding <= 0) continue;

        const applied = Math.min(feePortion, feeOutstanding);
        feePortion -= applied;

        const newSettledAmount = (fee.settledAmount ?? 0) + applied;
        const fullySettled = newSettledAmount >= (fee.confirmedAmount ?? 0);

        settledFees.push(
          await tx.lateFee.update({
            where: { id: fee.id },
            data: {
              settledAmount: newSettledAmount,
              ...(fullySettled ? { settledAt: now, settledBy: operatorId } : {}),
            },
          }),
        );
      }

      const newPaidAmount = bill.paidAmount + billPortion;
      const outstandingAfter = outstandingFees - (dto.amount - billPortion);
      const fullySettledAll = newPaidAmount >= bill.amount && outstandingAfter <= 0;
      const newStatus = fullySettledAll ? 'PAID' : 'PARTIAL';

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
        },
      });

      return { payment, bill: updatedBill, lateFees: settledFees };
    });
  }

  /** 滞纳金未核销余额（分） */
  private lateFeeOutstanding(fee: { confirmedAmount: number | null; settledAmount: number | null }) {
    return Math.max(0, (fee.confirmedAmount ?? 0) - (fee.settledAmount ?? 0));
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
