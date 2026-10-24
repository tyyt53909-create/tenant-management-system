import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { BillType } from '../bills/dto/create-bill.dto.js';
import { getBusinessDateParts, formatDate, formatAmount } from './scheduler.util.js';

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

  async generateMonthlyBills(now: Date = new Date()): Promise<MonthlyBillSummary> {
    const { year, month } = getBusinessDateParts(now);
    const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
    const currentPeriod = `${year}-${String(month).padStart(2, '0')}`;

    const summary: MonthlyBillSummary = { period: currentPeriod, generated: 0, skipped: 0, notified: 0, errors: [] };

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: currentMonthStart },
      },
      include: { tenant: { select: { userId: true } } },
    });

    for (const contract of contracts) {
        const cycleMonths = ({ MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 } as Record<string, number>)[contract.paymentCycle];
        if (!cycleMonths) continue;

        const contractStart = new Date(contract.startDate);
        const contractEnd = new Date(contract.endDate);
        const startParts = getBusinessDateParts(contractStart);
        const startIndex = startParts.year * 12 + (startParts.month - 1);
        const currentIndex = year * 12 + (month - 1);
        const elapsedMonths = currentIndex - startIndex;
        // 以「合同起始月」为锚点，每 cycleMonths 个月出一次账；
        // 不能按自然年 1/4/7/10 月，否则 2 月起的季付合同会错过首期。
        if (elapsedMonths < 0 || elapsedMonths % cycleMonths !== 0) continue;

        const periodStart = new Date(Date.UTC(year, month - 1, 1));
        const periodEnd = new Date(Date.UTC(year, month - 1 + cycleMonths, 0));
        const period = `${year}-${String(month).padStart(2, '0')}`;

        // 首期从合同起始日开始，末期截到合同结束日，按实际在租天数折算。
        const activeStart = contractStart > periodStart ? contractStart : periodStart;
        const activeEnd = contractEnd < periodEnd ? contractEnd : periodEnd;
        const cycleDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
        const proratedDays = Math.floor((activeEnd.getTime() - activeStart.getTime()) / 86_400_000) + 1;
        if (proratedDays <= 0 || proratedDays > cycleDays) continue;
        const amount = proratedDays === cycleDays
          ? contract.rentAmount
          : Math.round((contract.rentAmount * proratedDays) / cycleDays);
        // 逐个合同隔离：任何一个失败都不应中止其余合同的出账（T208）。
        // 原先整个迴圈共用一个 try/catch，第 N 个合同出错就再也发不出后面所有账单。
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

          const dueDate = new Date(Date.UTC(year, month - 1, Math.min(contract.paymentDay, 28)));

          const bill = await this.billsService.create({
            contractId: contract.id,
            billType: BillType.RENT,
            period,
            amount,
            dueDate: dueDate.toISOString(),
            snapshot: {
              rentAmount: contract.rentAmount,
              cycle: contract.paymentCycle,
              periodStart: periodStart.toISOString().slice(0, 10),
              periodEnd: periodEnd.toISOString().slice(0, 10),
              proratedDays,
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
