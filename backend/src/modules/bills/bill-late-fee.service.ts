import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { LateFeeRule, LateFeeUtil } from './utils/late-fee.util.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';

@Injectable()
export class BillLateFeeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 添加 / 刷新滞纳金（docs/04-状态机.md §3.4、docs/02-数据模型.md §2.9）
   * - 仅对已逾期（到期日 < 今日）且未缴清的账单生效
   * - 不带 confirmedAmount：生成或刷新「建议值」（同一账单只保留一条未确认建议，重复调用不重复建单）
   * - 带 confirmedAmount：管理者确认入账（金额可调整），确认后不可重复确认（409）
   *
   * `referenceDate` 供定时任务传入「业务日零点」：任务在凌晨 01:00 上海执行时，
   * 用真实 now 计算会把昨天的账单算成「逾期 0 天」，导致滞纳金建议整批失败（T208）。
   */
  async addLateFee(billId: string, dto: CreateLateFeeDto, operatorId: string, referenceDate?: Date) {
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

      const overdueDays = LateFeeUtil.overdueDays(bill.dueDate, referenceDate);
      if (overdueDays <= 0) {
        throw new BadRequestException('账单尚未逾期，无需计算滞纳金');
      }

      const baseAmount = bill.amount - bill.paidAmount;
      if (baseAmount <= 0) {
        throw apiError(ErrorCode.BILL_ALREADY_PAID, '账单已缴清，无需计算滞纳金');
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

        const now = new Date();
        const confirmData = {
          suggestedAmount: result.amount,
          overdueDays: result.overdueDays,
          calculation,
          confirmedAmount: dto.confirmedAmount,
          confirmedAt: now,
          confirmedBy: operatorId,
          // 减免为 0：无应收，直接视为结清（不产生未核销余额）
          ...(dto.confirmedAmount === 0
            ? { settledAmount: 0, settledAt: now, settledBy: operatorId }
            : {}),
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
