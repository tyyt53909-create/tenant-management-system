import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { JobRunner, PrismaAdvisoryJobLock, type JobTriggerName } from './job-runner.js';
import {
  SYSTEM_OPERATOR,
  TIMEZONE,
  MS_PER_DAY,
  NOTIFICATION_RETENTION_DAYS,
} from './scheduler.util.js';
import { SchedulerDailyJobsService } from './scheduler-daily-jobs.service.js';
import {
  SchedulerMonthlyBillsService,
  type MonthlyBillSummary,
} from './scheduler-monthly-bills.service.js';

export { SYSTEM_OPERATOR };
export type { MonthlyBillSummary };

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

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly dailyJobsService: SchedulerDailyJobsService;
  private readonly monthlyBillsService: SchedulerMonthlyBillsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billsService: BillsService,
    private readonly notificationsService: NotificationsService,
    @Optional() dailyJobsService?: SchedulerDailyJobsService,
    @Optional() monthlyBillsService?: SchedulerMonthlyBillsService,
  ) {
    this.dailyJobsService =
      dailyJobsService ??
      new SchedulerDailyJobsService(prisma, billsService, notificationsService);
    this.monthlyBillsService =
      monthlyBillsService ??
      new SchedulerMonthlyBillsService(prisma, billsService, notificationsService);
  }

  // ------------------------------------------------------------------
  // Cron 入口
  // ------------------------------------------------------------------

  /** 每日任务（Asia/Shanghai 凌晨 1:00） */
  @Cron('0 0 1 * * *', { name: 'daily-jobs', timeZone: TIMEZONE })
  async handleDailyCron() {
    await this.rerun('daily-jobs', 'CRON');
  }

  /** 月度账单生成（Asia/Shanghai 每月 1 日 01:10） */
  @Cron('0 10 1 * * *', { name: 'monthly-bill-generation', timeZone: TIMEZONE })
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
  // 委派给日常任务与月度账单子服务
  // ------------------------------------------------------------------

  async autoTransitionContracts(): Promise<{ activated: number; expired: number }> {
    return this.dailyJobsService.autoTransitionContracts();
  }

  async checkOverdueBills(): Promise<{ overdue: number; suggested: number }> {
    return this.dailyJobsService.checkOverdueBills();
  }

  async sendBillReminders(): Promise<number> {
    return this.dailyJobsService.sendBillReminders();
  }

  async autoConfirmMaintenance(): Promise<number> {
    return this.dailyJobsService.autoConfirmMaintenance();
  }

  async upgradeMaintenancePriority(): Promise<number> {
    return this.dailyJobsService.upgradeMaintenancePriority();
  }

  async notifyLowBalancePrepay(): Promise<number> {
    return this.dailyJobsService.notifyLowBalancePrepay();
  }

  async generateMonthlyBills(now: Date = new Date()): Promise<MonthlyBillSummary> {
    return this.monthlyBillsService.generateMonthlyBills(now);
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
}
