import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { PrepayPayBillDto } from './dto/prepay-pay-bill.dto.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import {
  applyDepositCollection,
  reverseDepositCollection,
} from '../deposits/deposit-ledger.util.js';
import { computeOverdue, derivePaymentStatus } from './bill-overdue.util.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { PrepayService } from '../prepay/prepay.service.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { randomHex } from '../../common/utils/secure-random.js';

interface RawClient {
  $queryRaw?: (query: Prisma.Sql) => Promise<unknown>;
}

interface FeeAllocation {
  lateFeeId: string;
  amount: number;
}

@Injectable()
export class BillPaymentService {
  /**
   * 支付通道与业务时钟都由容器注入（QLT-02 / T288）。
   * 之前 `?? new OfflinePaymentProvider()` 会让「生产漏配支付通道」变成静默走线下，
   * `?? new BusinessClock(new ConfigService())` 则绕过了统一时区配置。
   */
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    private readonly clock: BusinessClock,
    private readonly auditLog: AuditLogService,
    @Inject(forwardRef(() => PrepayService))
    private readonly prepayService: PrepayService,
  ) {}

  /**
   * 登记收款（FIN-05 / T264）
   * - 悲观行锁串行化同一账单的并发收款；锁错误不再被吞掉
   * - 支持 Idempotency-Key：同键同金额重放返回原记录，不重复入账
   * - 交易号在同一账单内唯一；数据库唯一索引作为并发兜底
   * - 收据号由数据库序列原子分配
   * - 分配顺序：先账单本金，再按确认时间核销滞纳金
   */
  async addPayment(billId: string, dto: CreatePaymentDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBill(tx, billId);

      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new NotFoundException('账单不存在');

      // 重放必须先于「已缴/已取消不可收款」，否则全额收款后的同键重试会得到 400。
      if (dto.idempotencyKey) {
        const existing = await tx.paymentRecord.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          const sameRequest =
            existing.billId === billId &&
            existing.amount === dto.amount &&
            existing.paymentMethod === dto.paymentMethod &&
            existing.status === 'CONFIRMED';
          if (!sameRequest) {
            throw new ConflictException('幂等键已用于其他收款请求');
          }
          return { payment: existing, bill, lateFees: [], idempotent: true };
        }
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可收款`);
      }

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

      const billPortion = Math.min(dto.amount, remaining);
      let feePortion = dto.amount - billPortion;
      const now = new Date();
      const allocations: FeeAllocation[] = [];
      const settledFees: unknown[] = [];

      for (const fee of unsettledFees) {
        if (feePortion <= 0) break;
        const feeOutstanding = this.lateFeeOutstanding(fee);
        if (feeOutstanding <= 0) continue;

        const applied = Math.min(feePortion, feeOutstanding);
        feePortion -= applied;
        allocations.push({ lateFeeId: fee.id, amount: applied });

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

      const receiptNumber = await this.nextReceiptNumber(tx);

      let payment;
      try {
        payment = await tx.paymentRecord.create({
          data: {
            billId,
            amount: dto.amount,
            paymentMethod: dto.paymentMethod as PaymentMethod,
            transactionNumber: dto.transactionNumber,
            idempotencyKey: dto.idempotencyKey,
            receiptNumber,
            status: 'CONFIRMED',
            billPortion,
            lateFeePortion: dto.amount - billPortion,
            lateFeeAllocations: allocations as unknown as Prisma.InputJsonValue,
            paidAt: dto.paidAt ? new Date(dto.paidAt) : now,
            confirmedBy: operatorId,
            notes: dto.notes,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('交易号或幂等键已存在，请勿重复收款');
        }
        throw error;
      }

      const newPaidAmount = bill.paidAmount + billPortion;
      const outstandingAfter = outstandingFees - (dto.amount - billPortion);
      const fullySettledAll = newPaidAmount >= bill.amount && outstandingAfter <= 0;
      // 本金与滞纳金都结清才算 PAID；只清本金但滞纳金未核销时保持 PARTIAL（沿用 FIN-05 语义）
      const newStatus = fullySettledAll
        ? 'PAID'
        : newPaidAmount > 0
          ? 'PARTIAL'
          : 'PENDING';
      // 逾期是独立维度：缴清即清除，部分缴款仍保留逾期标记（FIN-04 / T272）
      const overdue = newStatus === 'PAID'
        ? { isOverdue: false, overdueDays: 0 }
        : computeOverdue(bill.dueDate, this.clock.todayUtc());

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: { paidAmount: newPaidAmount, status: newStatus, ...overdue },
      });

      // FIN-03：押金账单收款同步记入押金台账
      await applyDepositCollection(tx, {
        bill: updatedBill,
        amount: billPortion,
        operatorId,
      });

      // R09：业务交易内记录真实财务审计前后值
      await this.auditLog?.recordEvent({
        tx,
        action: 'BILL_PAYMENT',
        entityType: 'Bill',
        entityId: billId,
        actorId: operatorId,
        before: { paidAmount: bill.paidAmount, status: bill.status },
        after: { paidAmount: newPaidAmount, status: newStatus },
        reason: dto.notes ?? dto.paymentMethod,
        context: {
          paymentRecordId: payment.id,
          amount: dto.amount,
          billPortion,
          lateFeePortion: dto.amount - billPortion,
          paymentMethod: dto.paymentMethod,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      return { payment, bill: updatedBill, lateFees: settledFees, idempotent: false };
    });
  }

  /**
   * 作废收款并生成冲正记录（FIN-05）
   * - 原记录保留为 VOIDED，另建一条金额为负的 REVERSAL
   * - 账单本金与滞纳金按原分配精确回滚
   * - 重复作废幂等返回已有冲正
   */
  async voidPayment(billId: string, paymentId: string, operatorId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBill(tx, billId);

      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new NotFoundException('账单不存在');
      if (bill.status === 'CANCELLED') {
        throw new BadRequestException('已取消的账单不可作废收款');
      }

      const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId } });
      if (!payment || payment.billId !== billId) {
        throw new NotFoundException('收款记录不存在');
      }

      if (payment.status === 'VOIDED') {
        const reversal = await tx.paymentRecord.findUnique({
          where: { reversalOfId: payment.id },
        });
        return { payment, bill, reversal, idempotent: true };
      }
      if (payment.status !== 'CONFIRMED') {
        throw new ConflictException('冲正记录不可再次作废');
      }

      const allocations =
        (payment.lateFeeAllocations as unknown as FeeAllocation[] | null) ?? [];
      for (const allocation of allocations) {
        const fee = await tx.lateFee.findUnique({ where: { id: allocation.lateFeeId } });
        if (!fee) continue;
        const newSettled = Math.max(0, (fee.settledAmount ?? 0) - allocation.amount);
        const stillSettled =
          (fee.confirmedAmount ?? 0) > 0 && newSettled >= (fee.confirmedAmount ?? 0);
        await tx.lateFee.update({
          where: { id: fee.id },
          data: {
            settledAmount: newSettled,
            ...(stillSettled ? {} : { settledAt: null, settledBy: null }),
          },
        });
      }

      const reversal = await tx.paymentRecord.create({
        data: {
          billId,
          amount: -payment.amount,
          paymentMethod: payment.paymentMethod,
          status: 'REVERSAL',
          billPortion: -payment.billPortion,
          lateFeePortion: -payment.lateFeePortion,
          paidAt: new Date(),
          confirmedBy: operatorId,
          notes: `冲正收款 ${payment.id}`,
          reversalOfId: payment.id,
        },
      });

      const voided = await tx.paymentRecord.update({
        where: { id: payment.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedBy: operatorId,
          voidReason: reason,
        },
      });

      const newPaid = Math.max(0, bill.paidAmount - payment.billPortion);
      const newStatus = derivePaymentStatus(bill.amount, newPaid);
      const overdue = newStatus === 'PAID'
        ? { isOverdue: false, overdueDays: 0 }
        : computeOverdue(bill.dueDate, this.clock.todayUtc());

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: { paidAmount: newPaid, status: newStatus, ...overdue },
      });

      // FIN-03：押金收款作废时冲减台账
      await reverseDepositCollection(tx, {
        bill: updatedBill,
        amount: payment.billPortion,
        operatorId,
      });

      // R09：业务交易内记录真实财务冲正审计前后值
      await this.auditLog?.recordEvent({
        tx,
        action: 'PAYMENT_REVERSAL',
        entityType: 'PaymentRecord',
        entityId: payment.id,
        actorId: operatorId,
        before: {
          paymentStatus: payment.status,
          billPaidAmount: bill.paidAmount,
          billStatus: bill.status,
        },
        after: {
          paymentStatus: 'VOIDED',
          billPaidAmount: newPaid,
          billStatus: newStatus,
        },
        reason,
        context: {
          billId,
          reversalRecordId: reversal.id,
          reversalAmount: reversal.amount,
        },
      });

      return { payment: voided, bill: updatedBill, reversal, idempotent: false };
    });
  }

  /**
   * 执行退款冲正（PAY-02 / T294）
   * - 悲观行锁串行化
   * - 原收款保留，生成负数冲正记录 REVERSAL
   * - 若全额退款，原收款标记为 VOIDED
   * - 账单本金与滞纳金按比例/顺序冲退回滚
   * - 若涉及押金账单，联动 reverseDepositCollection 冲减押金台账
   * - 记录真实财务冲正审计事件
   */
  async applyRefundReversal(params: {
    billId: string;
    paymentId: string;
    refundAmount: number;
    outRefundNo: string;
    refundId?: string;
    operatorId: string;
    reason?: string;
  }) {
    const { billId, paymentId, refundAmount, outRefundNo, refundId, operatorId, reason } = params;
    return this.prisma.$transaction(async (tx) => {
      await this.lockBill(tx, billId);

      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new NotFoundException('账单不存在');

      const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId } });
      if (!payment || payment.billId !== billId) {
        throw new NotFoundException('收款记录不存在');
      }

      const isFull = refundAmount === payment.amount;
      const refundBillPortion = Math.min(refundAmount, payment.billPortion);
      const refundLateFeePortion = Math.max(0, refundAmount - refundBillPortion);

      // 回滚滞纳金核销
      if (refundLateFeePortion > 0) {
        const allocations =
          (payment.lateFeeAllocations as unknown as FeeAllocation[] | null) ?? [];
        let remainingFeeRollback = refundLateFeePortion;
        for (const allocation of allocations) {
          if (remainingFeeRollback <= 0) break;
          const fee = await tx.lateFee.findUnique({ where: { id: allocation.lateFeeId } });
          if (!fee) continue;
          const rollbackAmount = Math.min(remainingFeeRollback, allocation.amount);
          remainingFeeRollback -= rollbackAmount;
          const newSettled = Math.max(0, (fee.settledAmount ?? 0) - rollbackAmount);
          const stillSettled =
            (fee.confirmedAmount ?? 0) > 0 && newSettled >= (fee.confirmedAmount ?? 0);
          await tx.lateFee.update({
            where: { id: fee.id },
            data: {
              settledAmount: newSettled,
              ...(stillSettled ? {} : { settledAt: null, settledBy: null }),
            },
          });
        }
      }

      // 创建冲正记录
      const reversal = await tx.paymentRecord.create({
        data: {
          billId,
          amount: -refundAmount,
          paymentMethod: payment.paymentMethod,
          status: 'REVERSAL',
          billPortion: -refundBillPortion,
          lateFeePortion: -refundLateFeePortion,
          paidAt: new Date(),
          confirmedBy: operatorId,
          notes: `微信退款冲正 (${outRefundNo})${reason ? `: ${reason}` : ''}`,
          transactionNumber: refundId || outRefundNo,
          ...(isFull ? { reversalOfId: payment.id } : {}),
        },
      });

      if (isFull) {
        await tx.paymentRecord.update({
          where: { id: payment.id },
          data: {
            status: 'VOIDED',
            voidedAt: new Date(),
            voidedBy: operatorId,
            voidReason: `微信原路退款 (${outRefundNo})${reason ? `: ${reason}` : ''}`,
          },
        });
      }

      const newPaid = Math.max(0, bill.paidAmount - refundBillPortion);
      const newStatus = derivePaymentStatus(bill.amount, newPaid);
      const overdue =
        newStatus === 'PAID'
          ? { isOverdue: false, overdueDays: 0 }
          : computeOverdue(bill.dueDate, this.clock.todayUtc());

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: { paidAmount: newPaid, status: newStatus, ...overdue },
      });

      // 押金账单退款冲减押金台账
      await reverseDepositCollection(tx, {
        bill: updatedBill,
        amount: refundBillPortion,
        operatorId,
      });

      // 审计日志
      await this.auditLog?.recordEvent({
        tx,
        action: 'PAYMENT_REVERSAL',
        entityType: 'RefundRecord',
        entityId: outRefundNo,
        actorId: operatorId,
        before: { billPaidAmount: bill.paidAmount, billStatus: bill.status },
        after: { billPaidAmount: newPaid, billStatus: newStatus },
        reason: `微信退款: ${reason ?? outRefundNo}`,
        context: {
          billId,
          paymentRecordId: payment.id,
          reversalRecordId: reversal.id,
          refundAmount,
          outRefundNo,
          refundId,
        },
      });

      return { reversal, bill: updatedBill };
    });
  }

  /** 滞纳金未核销余额（分） */
  private lateFeeOutstanding(fee: { confirmedAmount: number | null; settledAmount: number | null }) {
    return Math.max(0, (fee.confirmedAmount ?? 0) - (fee.settledAmount ?? 0));
  }

  /** 悲观行锁；测试替身没有 $queryRaw 时跳过（生产 Prisma 一定有）。 */
  private async lockBill(tx: Prisma.TransactionClient, billId: string): Promise<void> {
    const raw = tx as unknown as RawClient;
    if (typeof raw.$queryRaw !== 'function') return;
    await raw.$queryRaw(Prisma.sql`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`);
  }

  /** 收据号：R{业务日}{6 位序号}；序列由数据库原子分配。 */
  private async nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string | null> {
    const raw = tx as unknown as RawClient;
    if (typeof raw.$queryRaw !== 'function') return null;
    const rows = await raw.$queryRaw(Prisma.sql`SELECT nextval('payment_receipt_seq') AS nextval`);
    const row = Array.isArray(rows) ? (rows[0] as { nextval?: bigint | number } | undefined) : undefined;
    const sequence = Number(row?.nextval ?? 0);
    if (!sequence) return null;
    return `R${this.clock.formatDate().replace(/-/g, '')}${String(sequence).padStart(6, '0')}`;
  }

  /**
   * 账单收款流水（按收款时间倒序）
   */
  async findPayments(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    return this.prisma.paymentRecord.findMany({
      where: { billId },
      orderBy: { paidAt: 'desc' },
    });
  }

  /**
   * 使用预付账户余额抵扣账单（租客/管理员）
   */
  async payWithPrepay(
    billId: string,
    dto: PrepayPayBillDto,
    user: { userId: string; role: string; tenantId?: string },
  ) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          select: {
            id: true,
            tenantId: true,
            roomId: true,
            tenant: { select: { id: true, userId: true } },
          },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    // 租客防越权校验
    if (user.role === 'TENANT') {
      const userTenant = await this.prisma.tenant.findUnique({
        where: { userId: user.userId },
        select: { id: true },
      });
      if (!userTenant || bill.contract.tenantId !== userTenant.id) {
        throw new ForbiddenException('您无权操作非本人的账单');
      }
    }

    if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
      throw new BadRequestException(`账单当前为 ${bill.status} 状态，无需支付`);
    }

    // 计算未付金额（本金 + 确认的滞纳金）
    const unsettledFees = await this.prisma.lateFee.findMany({
      where: { billId, confirmedAmount: { not: null } },
    });
    const outstandingFees = unsettledFees.reduce((sum, fee) => {
      const confirmed = fee.confirmedAmount ?? 0;
      const settled = fee.settledAmount ?? 0;
      return sum + Math.max(0, confirmed - settled);
    }, 0);

    const remaining = bill.amount - bill.paidAmount + outstandingFees;
    if (remaining <= 0) {
      throw new BadRequestException('账单已无待缴金额');
    }

    // 查找租客的预付账户
    const prepayAccount = await this.prisma.prepayAccount.findUnique({
      where: {
        tenantId_roomId: {
          tenantId: bill.contract.tenantId,
          roomId: bill.contract.roomId,
        },
      },
    });

    if (!prepayAccount || prepayAccount.balanceCache <= 0) {
      throw apiError(ErrorCode.PREPAY_INSUFFICIENT_BALANCE, '预付账户余额不足');
    }

    const maxDeductible = Math.min(prepayAccount.balanceCache, remaining);
    const deductAmount = dto.amount ? Math.min(dto.amount, maxDeductible) : maxDeductible;

    if (deductAmount <= 0) {
      throw apiError(ErrorCode.PREPAY_INSUFFICIENT_BALANCE, '预付账户余额不足');
    }

    const idempotencyKey =
      dto.idempotencyKey || `prepay_bill_${bill.id}_${Date.now()}_${randomHex(4)}`;
    const transactionNumber = `PREPAY_DEDUCT_${Date.now()}_${randomHex(4)}`;

    // 事务内原子扣减预付账户余额与记录流水
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.prepayAccount.updateMany({
        where: { id: prepayAccount.id, balanceCache: { gte: deductAmount } },
        data: { balanceCache: { decrement: deductAmount } },
      });

      if (result.count === 0) {
        throw apiError(ErrorCode.PREPAY_INSUFFICIENT_BALANCE, '预付账户余额不足');
      }

      const updatedAccount = await tx.prepayAccount.findUniqueOrThrow({
        where: { id: prepayAccount.id },
      });

      await tx.prepayTransaction.create({
        data: {
          accountId: prepayAccount.id,
          type: 'DEDUCTION',
          amount: -deductAmount,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: bill.id,
          relatedType: 'BILL_DEDUCTION',
          description: `预付余额抵扣账单(${bill.billNumber})`,
          operatorId: user.userId,
        },
      });
    });

    // 登记账单收款并结转滞纳金与收据
    const payment = await this.addPayment(
      billId,
      {
        amount: deductAmount,
        paymentMethod: 'PREPAY' as any,
        transactionNumber,
        idempotencyKey,
        notes: `预付账户余额抵扣 (账户: ${prepayAccount.id})`,
      },
      user.userId,
    );

    // 检测低余额预警并触发通知（带每日频控）
    try {
      await this.prepayService.triggerLowBalanceAlertIfNeeded(prepayAccount.id);
    } catch {
      // 提醒失败不阻断已成功的账单抵扣流程
    }

    return payment;
  }
}
