import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { LateFeeUtil } from '../bills/utils/late-fee.util.js';
import { BillType } from '../bills/dto/create-bill.dto.js';
import { JobRunner, PrismaAdvisoryJobLock, type JobTriggerName } from './job-runner.js';

/**
 * 定时任务（docs/04-状态机.md §2/§3/§4、docs/02-数据模型.md）
 *
 * 每日（Asia/Shanghai 凌晨 1:00）：
 *   1. 合同自动流转：DRAFT → ACTIVE（生效日到达，预留房间随动 OCCUPIED）；ACTIVE → EXPIRED（到期 + 提醒）
 *   2. 逾期检查：PENDING/PARTIAL 到期未缴 → OVERDUE + 滞纳金建议 + 逾期提醒
 *   3. 账单提醒：到期前 3 天 / 到期日 / 逾期 1、3、7 天（同日同标题去重）
 *   4. 报修：PENDING_CONFIRM 超 3 天自动确认 COMPLETED；SUBMITTED 普通工单超 3 天自动升级 URGENT
 *   5. 预付账户：余额低于阈值提醒（每账户每日最多一次）
 *
 * 每月 1 日 01:10：月租金账单生成（ACTIVE + MONTHLY 循环，快照租金，含收租提醒）
 */

export const SYSTEM_OPERATOR = 'system';

const TIMEZONE = 'Asia/Shanghai';
const MS_PER_DAY = 86_400_000;
const NOTIFICATION_RETENTION_DAYS = 180;

export const SCHEDULER_JOBS = [
  'daily-jobs',
  'monthly-bill-generation',
  'notification-cleanup',
] as const;

export type SchedulerJobName = (typeof SCHEDULER_JOBS)[number];

export interface DailyJobSummary {
  contractsActivated: number;
  contractsExpired: number;
  billsOverdue: number;
  lateFeesSuggested: number;
  remindersSent: number;
  maintenanceAutoConfirmed: number;
  priorityUpgraded: number;
  prepayNotificationsSent: number;
  errors: string[];
}

export interface MonthlyBillSummary {
  period: string;
  generated: number;
  skipped: number;
  notified: number;
  errors: string[];
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billsService: BillsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ------------------------------------------------------------------
  // Cron 入口
  // ------------------------------------------------------------------

  /** 每日任务（Asia/Shanghai 凌晨 1:00） */
  @Cron('0 0 1 * * *', { name: 'daily-jobs', timeZone: TIMEZONE })
  async handleDailyCron() {
    await this.rerun('daily-jobs', 'CRON');
  }

  /** 月度账单生成（Asia/Shanghai 每月 1 日 01:10） */
  @Cron('0 10 1 * *', { name: 'monthly-bill-generation', timeZone: TIMEZONE })
  async handleMonthlyBillCron() {
    await this.rerun('monthly-bill-generation', 'CRON');
  }

  /** 通知保留 180 天（Asia/Shanghai 每日 01:20） */
  @Cron('0 20 1 * * *', { name: 'notification-cleanup', timeZone: TIMEZONE })
  async handleNotificationCleanupCron() {
    await this.rerun('notification-cleanup', 'CRON');
  }

  /**
   * 带咨询锁执行。另一个实例抢不到锁时记 SKIPPED，不重复跑任务。
   */
  rerun(name: string, trigger: JobTriggerName) {
    if (!this.isJobName(name)) {
      throw new NotFoundException('未知的定时任务');
    }
    const jobs: Record<SchedulerJobName, () => Promise<unknown>> = {
      'daily-jobs': () => this.runDaily(),
      'monthly-bill-generation': () => this.generateMonthlyBills(),
      'notification-cleanup': () => this.cleanupExpiredNotifications(),
    };
    return new JobRunner(this.prisma, new PrismaAdvisoryJobLock(this.prisma)).run(name, trigger, jobs[name]);
  }

  /** 删除超过 180 天的通知。 */
  async cleanupExpiredNotifications(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * MS_PER_DAY);
    const result = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.log(`通知清理完成：删除 ${result.count} 条，早于 ${cutoff.toISOString()}`);
    return result.count;
  }

  private isJobName(name: string): name is SchedulerJobName {
    return (SCHEDULER_JOBS as readonly string[]).includes(name);
  }

  // ------------------------------------------------------------------
  // 每日任务聚合（单项失败不影响其他项）
  // ------------------------------------------------------------------

  async runDaily(): Promise<DailyJobSummary> {
    const summary: DailyJobSummary = {
      contractsActivated: 0,
      contractsExpired: 0,
      billsOverdue: 0,
      lateFeesSuggested: 0,
      remindersSent: 0,
      maintenanceAutoConfirmed: 0,
      priorityUpgraded: 0,
      prepayNotificationsSent: 0,
      errors: [],
    };

    await this.runJob(summary.errors, '合同自动流转', async () => {
      const result = await this.autoTransitionContracts();
      summary.contractsActivated = result.activated;
      summary.contractsExpired = result.expired;
    });

    await this.runJob(summary.errors, '逾期检查', async () => {
      const result = await this.checkOverdueBills();
      summary.billsOverdue = result.overdue;
      summary.lateFeesSuggested = result.suggested;
    });

    await this.runJob(summary.errors, '账单提醒', async () => {
      summary.remindersSent = await this.sendBillReminders();
    });

    await this.runJob(summary.errors, '报修自动确认', async () => {
      summary.maintenanceAutoConfirmed = await this.autoConfirmMaintenance();
    });

    await this.runJob(summary.errors, '工单优先级升级', async () => {
      summary.priorityUpgraded = await this.upgradeMaintenancePriority();
    });

    await this.runJob(summary.errors, '预付低余额提醒', async () => {
      summary.prepayNotificationsSent = await this.notifyLowBalancePrepay();
    });

    this.logger.log(`每日任务完成：${JSON.stringify(summary)}`);
    return summary;
  }

  // ------------------------------------------------------------------
  // 1. 合同自动流转
  // ------------------------------------------------------------------

  async autoTransitionContracts(): Promise<{ activated: number; expired: number }> {
    const now = new Date();
    const today = this.startOfTodayUtc(now);

    // DRAFT → ACTIVE（生效日到达）
    const draftContracts = await this.prisma.contract.findMany({
      where: { status: 'DRAFT', startDate: { lte: now } },
      select: { id: true, roomId: true },
    });

    let activated = 0;
    for (const contract of draftContracts) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE' },
      });
      activated++;

      // 房间随动：预留 → 已入住（仅当仍为 RESERVED，遵循房态状态机前置条件）
      const room = await this.prisma.room.findUnique({ where: { id: contract.roomId } });
      if (room && room.status === 'RESERVED') {
        await this.prisma.room.update({
          where: { id: room.id },
          data: { status: 'OCCUPIED', version: { increment: 1 } },
        });
      }
    }

    // ACTIVE → EXPIRED（到期日已过）+ 到期提醒
    const expiredContracts = await this.prisma.contract.findMany({
      where: { status: 'ACTIVE', endDate: { lt: today } },
      select: {
        id: true,
        endDate: true,
        tenant: { select: { userId: true } },
      },
    });

    let expired = 0;
    for (const contract of expiredContracts) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'EXPIRED' },
      });
      expired++;

      if (contract.tenant?.userId) {
        await this.notify(
          contract.tenant.userId,
          '合同已到期',
          `您的合同已于 ${this.formatDate(contract.endDate)} 到期`,
          'NORMAL',
        );
      }
    }

    return { activated, expired };
  }

  // ------------------------------------------------------------------
  // 2. 逾期检查（PENDING/PARTIAL → OVERDUE + 滞纳金建议 + 提醒）
  // ------------------------------------------------------------------

  async checkOverdueBills(): Promise<{ overdue: number; suggested: number }> {
    const today = this.startOfTodayUtc();

    const bills = await this.prisma.bill.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: today } },
      include: { contract: { include: { tenant: { select: { userId: true } } } } },
    });

    let overdue = 0;
    let suggested = 0;

    for (const bill of bills) {
      await this.prisma.bill.update({
        where: { id: bill.id },
        data: { status: 'OVERDUE' },
      });
      overdue++;

      // 未缴金额 > 0 时刷新滞纳金建议（已确认的账单会 409，跳过）
      if (bill.amount - bill.paidAmount > 0) {
        try {
          await this.billsService.addLateFee(bill.id, {}, SYSTEM_OPERATOR);
          suggested++;
        } catch (error) {
          if (!(error instanceof ConflictException)) {
            this.logger.warn(`滞纳金建议失败（billId=${bill.id}）：${(error as Error).message}`);
          }
        }
      }

      const userId = bill.contract?.tenant?.userId;
      if (userId) {
        const overdueDays = LateFeeUtil.overdueDays(bill.dueDate);
        await this.notify(
          userId,
          '账单逾期提醒',
          `您有账单逾期 ${overdueDays} 天，请尽快缴费`,
          'URGENT',
          { billId: bill.id },
        );
      }
    }

    return { overdue, suggested };
  }

  // ------------------------------------------------------------------
  // 3. 账单提醒（到期前 3 天 / 到期日 / 逾期 1、3、7 天）
  // ------------------------------------------------------------------

  async sendBillReminders(): Promise<number> {
    const today = this.startOfTodayUtc();

    const bills = await this.prisma.bill.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
      include: { contract: { include: { tenant: { select: { userId: true } } } } },
    });

    let sent = 0;

    for (const bill of bills) {
      const userId = bill.contract?.tenant?.userId;
      if (!userId) continue;

      const overdueDays = LateFeeUtil.overdueDays(bill.dueDate);
      let title: string | null = null;
      let body = '';
      let priority: 'NORMAL' | 'URGENT' = 'NORMAL';

      if (overdueDays > 0) {
        if ([1, 3, 7].includes(overdueDays)) {
          title = '账单逾期提醒';
          body = `您有账单逾期 ${overdueDays} 天，请尽快缴费`;
          priority = 'URGENT';
        }
      } else {
        const daysUntilDue = this.daysBetween(today, this.startOfTodayUtc(bill.dueDate));
        if (daysUntilDue === 3) {
          title = '账单即将到期提醒';
          body = `您的账单将于 ${this.formatDate(bill.dueDate)} 到期，请及时缴费`;
        } else if (daysUntilDue === 0) {
          title = '账单到期提醒';
          body = '您的账单今日到期，请及时缴费';
        }
      }

      if (!title) continue;

      // 同日同标题去重（同一收件人当天只发一次）
      const existing = await this.prisma.notification.findFirst({
        where: { userId, title, createdAt: { gte: today } },
        select: { id: true },
      });
      if (existing) continue;

      await this.notify(userId, title, body, priority, { billId: bill.id });
      sent++;
    }

    return sent;
  }

  // ------------------------------------------------------------------
  // 4. 报修：自动确认 + 优先级升级
  // ------------------------------------------------------------------

  async autoConfirmMaintenance(): Promise<number> {
    const threeDaysAgo = new Date(Date.now() - 3 * MS_PER_DAY);

    const result = await this.prisma.maintenanceRequest.updateMany({
      where: { status: 'PENDING_CONFIRM', updatedAt: { lt: threeDaysAgo } },
      data: {
        status: 'COMPLETED',
        resolvedAt: new Date(),
        resolution: '租客3天内未反馈，系统自动确认完成',
      },
    });

    return result.count;
  }

  async upgradeMaintenancePriority(): Promise<number> {
    const threeDaysAgo = new Date(Date.now() - 3 * MS_PER_DAY);

    const result = await this.prisma.maintenanceRequest.updateMany({
      where: {
        status: 'SUBMITTED',
        priority: 'NORMAL',
        createdAt: { lt: threeDaysAgo },
      },
      data: { priority: 'URGENT' },
    });

    return result.count;
  }

  // ------------------------------------------------------------------
  // 5. 预付账户低余额提醒（每账户每日最多一次）
  // ------------------------------------------------------------------

  async notifyLowBalancePrepay(): Promise<number> {
    const today = this.startOfTodayUtc();

    const accounts = await this.prisma.prepayAccount.findMany({
      where: {
        balanceCache: { lt: this.prisma.prepayAccount.fields.lowBalanceThreshold },
        OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: today } }],
      },
      include: { tenant: { select: { userId: true } } },
    });

    let sent = 0;

    for (const account of accounts) {
      const userId = account.tenant?.userId;
      if (!userId) continue;

      await this.notify(
        userId,
        '预付余额不足提醒',
        `您的预付账户余额 ¥${this.formatAmount(account.balanceCache)} 已低于提醒阈值 ¥${this.formatAmount(account.lowBalanceThreshold)}，请及时充值`,
        'NORMAL',
        { prepayAccountId: account.id },
      );

      await this.prisma.prepayAccount.update({
        where: { id: account.id },
        data: { lastNotifiedAt: new Date() },
      });
      sent++;
    }

    return sent;
  }

  // ------------------------------------------------------------------
  // 每月账单生成
  // ------------------------------------------------------------------

  async generateMonthlyBills(now: Date = new Date()): Promise<MonthlyBillSummary> {
    const { year, month } = this.getBusinessDateParts(now);
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

        await this.billsService.create({
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
        summary.generated++;

        if (contract.tenant?.userId) {
          await this.notify(
            contract.tenant.userId,
            '收租提醒',
            `您有新的租金账单（${period}），金额 ¥${this.formatAmount(contract.rentAmount)}，请于 ${this.formatDate(dueDate)} 前缴纳`,
            'NORMAL',
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

  // ------------------------------------------------------------------
  // 内部工具
  // ------------------------------------------------------------------

  /** 获取业务时区（Asia/Shanghai）的年月日 */
  private getBusinessDateParts(date: Date = new Date(), timeZone: string = TIMEZONE): {
    year: number;
    month: number;
    day: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth() + 1;
    let day = date.getUTCDate();
    for (const part of parts) {
      if (part.type === 'year') year = parseInt(part.value, 10);
      if (part.type === 'month') month = parseInt(part.value, 10);
      if (part.type === 'day') day = parseInt(part.value, 10);
    }
    return { year, month, day };
  }

  /** 通知发送（失败不阻断任务，仅记录日志） */
  private async notify(
    userId: string,
    title: string,
    body: string,
    priority: 'NORMAL' | 'URGENT',
    data?: Record<string, unknown>,
  ) {
    try {
      await this.notificationsService.create({ userId, title, body, priority: priority as NotificationPriority, data });
    } catch (error) {
      this.logger.warn(`通知发送失败（userId=${userId}）：${(error as Error).message}`);
    }
  }

  /** 单项任务隔离执行：失败记录到 errors 并继续后续任务 */
  private async runJob(errors: string[], name: string, job: () => Promise<void>) {
    try {
      await job();
    } catch (error) {
      const message = `${name}失败：${(error as Error).message}`;
      errors.push(message);
      this.logger.error(message);
    }
  }

  /** 今日零点（按 Asia/Shanghai 业务日历日期的 00:00:00 UTC，与 @db.Date 存储一致） */
  private startOfTodayUtc(now: Date = new Date()): Date {
    const { year, month, day } = this.getBusinessDateParts(now);
    return new Date(Date.UTC(year, month - 1, day));
  }

  /** 自然日差值（to - from，按 UTC 日历日） */
  private daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  }

  /** YYYY-MM-DD（UTC） */
  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /** 分 → 元（两位小数） */
  private formatAmount(amountInCents: number): string {
    return (amountInCents / 100).toFixed(2);
  }
}
