import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { BillType } from '../bills/dto/create-bill.dto.js';
import { getBusinessDateParts, formatDate, formatAmount } from './scheduler.util.js';
import { CYCLE_MONTHS, RENT_ROUNDING, dueAnchorMonths, quoteRentCycle } from './rent-charge.js';

export interface MonthlyBillSummary {
  period: string;
  generated: number;
  skipped: number;
  notified: number;
  errors: string[];
}

@Injectable()
export class SchedulerMonthlyBillsService {
  private readonly logger = new Logger(SchedulerMonthlyBillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billsService: BillsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** 合同生效时补出已到期账期，包括首期。重跑由账期幂等键跳过。 */
  async issueDueRentBills(contractId: string, now: Date = new Date()): Promise<MonthlyBillSummary> {
    return this.generateMonthlyBills(now, contractId);
  }

  async generateMonthlyBills(now: Date = new Date(), onlyContractId?: string): Promise<MonthlyBillSummary> {
    const { year, month } = getBusinessDateParts(now);
    const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
    const currentPeriod = `${year}-${String(month).padStart(2, '0')}`;

    const summary: MonthlyBillSummary = { period: currentPeriod, generated: 0, skipped: 0, notified: 0, errors: [] };

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: currentMonthStart },
        ...(onlyContractId ? { id: onlyContractId } : {}),
      },
      include: { tenant: { select: { userId: true } } },
    });

    for (const contract of contracts) {
        const cycleMonths = CYCLE_MONTHS[contract.paymentCycle];
        if (!cycleMonths) continue;
        const contractStart = getBusinessDateParts(new Date(contract.startDate));
        const contractEnd = getBusinessDateParts(new Date(contract.endDate));
        const anchors = dueAnchorMonths({
          contractStart,
          contractEnd,
          cycleMonths,
          asOf: { year, month, day: 1 },
        });
        for (const anchor of anchors) {
        const quote = quoteRentCycle({
          monthlyRent: contract.rentAmount,
          contractStart,
          contractEnd,
          anchorYear: anchor.year,
          anchorMonth: anchor.month,
          cycleMonths,
        });
        if (!quote) continue;
        const { amount, period, periodStart, periodEnd } = quote;
        // 逐个合同、逐个账期隔离。已有账单只跳过，不改已入账金额。
        try {
          // 幂等：同一合同同一账期已有租金账单则跳过
          const existing = await this.prisma.bill.findFirst({
            where: { contractId: contract.id, billType: 'RENT', period },
            select: { id: true },
          });
          if (existing) {
            summary.skipped++;
            continue;
          }

          const dueDate = new Date(Date.UTC(anchor.year, anchor.month - 1, Math.min(contract.paymentDay, 28)));

          const bill = await this.billsService.create({
            contractId: contract.id,
            billType: BillType.RENT,
            period,
            amount,
            dueDate: dueDate.toISOString(),
            snapshot: {
              rentAmount: contract.rentAmount,
              cycle: contract.paymentCycle,
              periodStart,
              periodEnd,
              rounding: RENT_ROUNDING,
              months: quote.months,
              paymentDay: contract.paymentDay,
              contractNumber: contract.contractNumber,
            },
          });
          if (bill.alreadyExists) {
            summary.skipped++;
            continue;
          }
          summary.generated++;

          if (contract.tenant?.userId) {
            const delivered = await this.notify(
              contract.tenant.userId,
              '收租提醒',
              `您有新的租金账单（${period}），金额 ¥${formatAmount(amount)}，请于 ${formatDate(dueDate)} 前缴纳`,
              'NORMAL',
              { billId: bill.id },
              `RENT_BILL:${contract.tenant.userId}:${period}`,
            );
            if (delivered) summary.notified++;
          }
        } catch (error) {
          const detail = `合同 ${contract.contractNumber ?? contract.id}：${(error as Error).message}`;
          summary.errors.push(detail);
          this.logger.error(`月度账单生成失败：${detail}`);
        }
        }
      }
    this.logger.log(`月度账单生成完成：${JSON.stringify(summary)}`);

    // 有合同失败时让任务以失败收尾：JobRunner 会把 job_runs 记为 FAILED 并留下 errorSummary，
    // 否则「部分合同没出账」会以 SUCCESS 静静写进运行记录，运维无从发现（T208）。
    if (summary.errors.length > 0) {
      throw new Error(
        `月度账单生成有 ${summary.errors.length} 个合同失败（成功 ${summary.generated}、跳过 ${summary.skipped}）：${summary.errors
          .slice(0, 3)
          .join('；')}`,
      );
    }

    return summary;
  }

  /** 发送通知；返回是否真的发出（失败只记日志，供调用方决定是否计入统计，T208）。 */
  private async notify(
    userId: string,
    title: string,
    body: string,
    priority: 'NORMAL' | 'URGENT',
    data?: Record<string, unknown>,
    dedupKey?: string,
  ): Promise<boolean> {
    try {
      await this.notificationsService.create({
        userId,
        title,
        body,
        priority: priority as NotificationPriority,
        data,
        dedupKey,
      });
      return true;
    } catch (error) {
      this.logger.warn(`通知发送失败（userId=${userId}）：${(error as Error).message}`);
      return false;
    }
  }
}
