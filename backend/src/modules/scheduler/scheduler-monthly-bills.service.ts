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
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));

    const summary: MonthlyBillSummary = { period, generated: 0, skipped: 0, notified: 0, errors: [] };

    try {
      const contracts = await this.prisma.contract.findMany({
        where: {
          status: 'ACTIVE',
          paymentCycle: 'MONTHLY',
          endDate: { gte: monthStart },
        },
        include: { tenant: { select: { userId: true } } },
      });

      for (const contract of contracts) {
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
          amount: contract.rentAmount,
          dueDate: dueDate.toISOString(),
          snapshot: {
            rentAmount: contract.rentAmount,
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
          await this.notify(
            contract.tenant.userId,
            '收租提醒',
            `您有新的租金账单（${period}），金额 ¥${formatAmount(contract.rentAmount)}，请于 ${formatDate(dueDate)} 前缴纳`,
            'NORMAL',
            { billId: bill.id },
            `RENT_BILL:${contract.tenant.userId}:${period}`,
          );
          summary.notified++;
        }
      }
    } catch (error) {
      summary.errors.push(`月度账单生成失败：${(error as Error).message}`);
      this.logger.error(`月度账单生成失败：${(error as Error).message}`);
    }

    this.logger.log(`月度账单生成完成：${JSON.stringify(summary)}`);
    return summary;
  }

  private async notify(
    userId: string,
    title: string,
    body: string,
    priority: 'NORMAL' | 'URGENT',
    data?: Record<string, unknown>,
    dedupKey?: string,
  ) {
    try {
      await this.notificationsService.create({
        userId,
        title,
        body,
        priority: priority as NotificationPriority,
        data,
        dedupKey,
      });
    } catch (error) {
      this.logger.warn(`通知发送失败（userId=${userId}）：${(error as Error).message}`);
    }
  }
}
