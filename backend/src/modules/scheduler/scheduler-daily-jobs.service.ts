import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationPriority } from '../notifications/dto/create-notification.dto.js';
import { LateFeeUtil, type LateFeeRule } from '../bills/utils/late-fee.util.js';
import { computeOverdue, dailyLateFeeAmount } from '../bills/bill-overdue.util.js';
import { roomUpdateForContractTransition } from '../contracts/contract-transitions.js';
import {
  SYSTEM_OPERATOR,
  MS_PER_DAY,
  startOfTodayUtc,
  startOfUtcDay,
  daysBetween,
  formatDate,
  formatAmount,
  getBusinessDateParts,
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
    // 用业务日零点而不是 now：01:00 上海执行时 now 仍是前一 UTC 日 17:00，
    // 当天起始日（UTC 零点）会晚约 24 小时才被激活（审查发现）。
    const draftContracts = await this.prisma.contract.findMany({
      where: { status: 'DRAFT', startDate: { lte: today } },
      select: { id: true, roomId: true, startDate: true, renewedFromId: true },
    });

    let activated = 0;
    for (const contract of draftContracts) {
      // 续签激活：旧合同 ACTIVE + 新合同 DRAFT 共存时，必须先在同一事务内
      // 把旧合同置为 RENEWED，再激活新合同；否则会撞“每房间一份 ACTIVE”的部分唯一索引。
      const didActivate = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${contract.roomId} FOR UPDATE`;
        const current = await tx.contract.findUnique({ where: { id: contract.id }, select: { status: true, roomId: true, startDate: true, renewedFromId: true } });
        if (!current || current.status !== 'DRAFT' || current.roomId !== contract.roomId || current.startDate.getTime() !== contract.startDate.getTime() || current.renewedFromId !== contract.renewedFromId || current.startDate > today) return false;
        let originalToRenew: string | null = null;
        if (contract.renewedFromId) {
          const original = await tx.contract.findUnique({
            where: { id: contract.renewedFromId },
            select: { id: true, status: true, endDate: true },
          });
          if (original?.status === 'ACTIVE') {
            if (contract.startDate <= original.endDate) {
              // 日期重叠属于数据错误，留给人工处理，不静默产生两份 ACTIVE
              return false;
            }
            originalToRenew = original.id;
          }
        }

        const otherActive = await tx.contract.findFirst({
          where: { roomId: contract.roomId, status: 'ACTIVE', id: { notIn: [contract.id, ...(originalToRenew ? [originalToRenew] : [])] } },
          select: { id: true },
        });
        if (otherActive) return false;
        const lockedRoom = await tx.room.findUnique({ where: { id: contract.roomId }, select: { status: true, cleanStatus: true } });
        if (!lockedRoom || (lockedRoom.status === 'VACANT' && ['PENDING_CLEAN', 'CLEANING'].includes(lockedRoom.cleanStatus))) return false;
        if (originalToRenew) {
          const changed = await tx.contract.updateMany({ where: { id: originalToRenew, status: 'ACTIVE' }, data: { status: 'RENEWED' } });
          if (!changed.count) return false;
        }

        await tx.contract.update({
          where: { id: contract.id },
          data: { status: 'ACTIVE' },
        });

        // 房间随动：预留 → 已入住。规则与 API 共用（contract-transitions.ts），
        // 只在其房态前置条件满足时随动，避免两处各写一份而漂移（T207）。
        const room = await tx.room.findUnique({
          where: { id: contract.roomId },
          select: { status: true },
        });
        if (room) {
          const roomUpdate = roomUpdateForContractTransition(room, 'DRAFT', 'ACTIVE');
          if (roomUpdate) {
            await tx.room.update({ where: { id: contract.roomId }, data: roomUpdate });
          }
        }
        return true;
      });

      if (didActivate) activated++;
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
      const changed = await this.prisma.contract.updateMany({
        where: { id: contract.id, status: 'ACTIVE', endDate: { lt: today } },
        data: { status: 'EXPIRED' },
      });
      if (!changed.count) continue;
      expired++;

      if (contract.tenant?.userId) {
        await this.notify(
          contract.tenant.userId,
          '合同已到期',
          `您的合同已于 ${formatDate(contract.endDate)} 到期`,
          'NORMAL',
          { contractId: contract.id },
          `CONTRACT_EXPIRED:${contract.tenant.userId}:${contract.id}`,
        );
      }
    }

    return { activated, expired };
  }

  // ------------------------------------------------------------------
  // 2. 逾期检查（独立 isOverdue + 每日滞纳金应计；提醒交给第 3 节，避免当天重复）
  // ------------------------------------------------------------------

  async checkOverdueBills(): Promise<{ overdue: number; suggested: number }> {
    const today = startOfTodayUtc();

    const bills = await this.prisma.bill.findMany({
      where: { status: { in: ['PENDING', 'PARTIAL'] }, dueDate: { lt: today } },
      include: {
        contract: {
          select: { lateFeeRule: true, tenant: { select: { userId: true } } },
        },
      },
    });

    let overdue = 0;
    let suggested = 0;

    for (const bill of bills) {
      const { overdueDays } = computeOverdue(bill.dueDate, today);
      await this.prisma.bill.update({
        where: { id: bill.id },
        data: { isOverdue: true, overdueDays },
      });
      overdue++;

      const baseAmount = bill.amount - bill.paidAmount;
      if (baseAmount <= 0) continue;

      try {
        // 当天增量 = 累计应付(today) - 累计应付(yesterday)，唯一键保证重复执行幂等
        const amount = dailyLateFeeAmount(
          (bill.contract?.lateFeeRule ?? {}) as LateFeeRule,
          baseAmount,
          overdueDays,
        );
        await this.prisma.lateFeeAccrual.upsert({
          where: { billId_accrualDate: { billId: bill.id, accrualDate: today } },
          create: { billId: bill.id, accrualDate: today, amount },
          update: { amount },
        });

        // 建议值仍以 LateFee 承载，刷新为当前累计应付
        await this.billsService.addLateFee(bill.id, {}, SYSTEM_OPERATOR, today);
        suggested++;
      } catch (error) {
        if (!(error instanceof ConflictException)) {
          this.logger.warn(`滞纳金应计失败（billId=${bill.id}）：${(error as Error).message}`);
        }
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
      where: { status: { in: ['PENDING', 'PARTIAL'] } },
      include: { contract: { include: { tenant: { select: { userId: true } } } } },
    });

    let sent = 0;

    for (const bill of bills) {
      const userId = bill.contract?.tenant?.userId;
      if (!userId) continue;

      const overdueDays = LateFeeUtil.overdueDays(bill.dueDate, today);
      let title: string | null = null;
      let body = '';
      let priority: 'NORMAL' | 'URGENT' = 'NORMAL';
      // 去重键必须带「节点」维度：1/3/7 天的 title 完全相同，只按 title 去重会把
      // 第 3、7 天当成重复而静默丢弃（T208）
      let nodeKey: string | null = null;

      if (overdueDays > 0) {
        if ([1, 3, 7].includes(overdueDays)) {
          title = '账单逾期提醒';
          body = `您有账单逾期 ${overdueDays} 天，请尽快缴费`;
          priority = 'URGENT';
          nodeKey = `overdue-d${overdueDays}`;
        }
      } else {
        const daysUntilDue = daysBetween(today, startOfTodayUtc(bill.dueDate));
        if (daysUntilDue === 3) {
          title = '账单即将到期提醒';
          body = `您的账单将于 ${formatDate(bill.dueDate)} 到期，请及时缴费`;
          nodeKey = `due-in-${daysUntilDue}`;
        } else if (daysUntilDue === 0) {
          title = '账单到期提醒';
          body = '您的账单今日到期，请及时缴费';
          nodeKey = `due-in-${daysUntilDue}`;
        }
      }

      if (!title || !nodeKey) continue;

      // 同日同标题去重（同一收件人当天只发一次）。
      // 注意基准要用「当前 UTC 自然日零点」：业务日零点在凌晨 01:00 执行时落在未来，
      // 拿它比 createdAt >= today 永远不成立（T208）。
      const existing = await this.prisma.notification.findFirst({
        where: { userId, title, createdAt: { gte: startOfUtcDay() } },
        select: { id: true },
      });
      if (existing) continue;

      const delivered = await this.notify(
        userId,
        title,
        body,
        priority,
        { billId: bill.id },
        `BILL_REMINDER:${userId}:${bill.id}:${nodeKey}`,
      );
      // 只有真的发出去才计入（notify 会吞掉失败并在日志里留痕）
      if (delivered) sent++;
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

      const { year, month, day } = getBusinessDateParts(today);
      const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      await this.notify(
        userId,
        '预付余额不足提醒',
        `您的预付账户余额 ¥${formatAmount(account.balanceCache)} 已低于提醒阈值 ¥${formatAmount(account.lowBalanceThreshold)}，请及时充值`,
        'NORMAL',
        { prepayAccountId: account.id },
        `LOW_BALANCE:${userId}:${account.id}:${dayKey}`,
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
  // 6. 合同到期梯次提醒（30天 / 15天 / 7天，LSE-04 / T301）
  // ------------------------------------------------------------------

  async sendExpiringContractReminders(): Promise<number> {
    const today = startOfTodayUtc();
    const maxDate = new Date(today.getTime() + 31 * MS_PER_DAY);

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: today, lte: maxDate },
      },
      include: {
        tenant: { select: { userId: true } },
        room: { select: { roomNumber: true } },
      },
    });

    let sent = 0;

    for (const contract of contracts) {
      const userId = contract.tenant?.userId;
      if (!userId) continue;

      const daysUntilExpire = daysBetween(today, startOfTodayUtc(contract.endDate));
      let title: string | null = null;
      let body = '';
      let nodeKey: string | null = null;

      if ([30, 15, 7].includes(daysUntilExpire)) {
        title = '合同即将到期提醒';
        body = `您承租的房间 ${contract.room?.roomNumber || ''} 合同将于 ${daysUntilExpire} 天后（${formatDate(contract.endDate)}）到期，请及时在移动端提交续约意向。`;
        nodeKey = `expiring-d${daysUntilExpire}`;
      }

      if (!title || !nodeKey) continue;

      const existing = await this.prisma.notification.findFirst({
        where: {
          userId,
          title,
          createdAt: { gte: startOfUtcDay() },
        },
        select: { id: true },
      });
      if (existing) continue;

      const delivered = await this.notify(
        userId,
        title,
        body,
        'NORMAL',
        { contractId: contract.id, daysUntilExpire },
        `CONTRACT_EXPIRING:${userId}:${contract.id}:${nodeKey}`,
      );
      if (delivered) sent++;
    }

    return sent;
  }

  /** 通知发送（失败不阻断任务，仅记录日志） */
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
