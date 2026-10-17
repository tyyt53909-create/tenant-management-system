import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { LateFeeUtil } from '../bills/utils/late-fee.util.js';
import {
  SYSTEM_OPERATOR,
  MS_PER_DAY,
  startOfTodayUtc,
  daysBetween,
  formatDate,
  formatAmount,
} from './scheduler.util.js';

@Injectable()
export class SchedulerDailyJobsService {
  private readonly logger = new Logger(SchedulerDailyJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billsService: BillsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ------------------------------------------------------------------
  // 1. 合同自动流转
  // ------------------------------------------------------------------

  async autoTransitionContracts(): Promise<{ activated: number; expired: number }> {
    const now = new Date();
    const today = startOfTodayUtc(now);

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
          `您的合同已于 ${formatDate(contract.endDate)} 到期`,
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
    const today = startOfTodayUtc();

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
    const today = startOfTodayUtc();

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
        const daysUntilDue = daysBetween(today, startOfTodayUtc(bill.dueDate));
        if (daysUntilDue === 3) {
          title = '账单即将到期提醒';
          body = `您的账单将于 ${formatDate(bill.dueDate)} 到期，请及时缴费`;
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
    const today = startOfTodayUtc();

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
        `您的预付账户余额 ¥${formatAmount(account.balanceCache)} 已低于提醒阈值 ¥${formatAmount(account.lowBalanceThreshold)}，请及时充值`,
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
}
