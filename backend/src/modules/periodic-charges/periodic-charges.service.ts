import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, type PeriodicChargeBatch, type PeriodicChargeItem } from '@prisma/client';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { rentBillDedupKey } from '../../common/utils/duplicate-keys.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { lockLeaseRoom } from '../contracts/contract-activation.js';
import type { BatchMeterReadingsDto } from '../meters/dto/batch-meter-reading.dto.js';
import { MeterBatchReadingService } from '../meters/meter-batch-reading.service.js';
import { MeterBillingService } from '../meters/meter-billing.service.js';
import { lockMeters, METER_WRITE_TRANSACTION } from '../meters/meter-settlement-state.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { blocked, reviewRent, reviewUtility, type ChargeReview } from './periodic-charge-plan.js';
import type { PreviewPeriodicChargeDto } from './periodic-charge.dto.js';

type Tx = Prisma.TransactionClient;
type Receipt = {
  state: string;
  reasonCode: string;
  reason?: string;
  retryCondition?: string;
  amount: number;
  billId?: string;
  prepayTransactionId?: string;
  confirmedBy?: string;
};
const transaction = { ...METER_WRITE_TRANSACTION, timeout: 30_000 };
const stale = () => blocked('STALE_REVIEW', '预览后结算资料发生变化', '重新检查并确认受影响项目');

class ChangedDuringCharge extends Error {}

@Injectable()
export class PeriodicChargesService {
  private readonly logger = new Logger(PeriodicChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly readings: MeterBatchReadingService,
    private readonly billing: MeterBillingService,
    private readonly notifications: NotificationsService,
  ) {}

  async collect(dto: BatchMeterReadingsDto, actor: string) {
    return this.readings.createBatchReadings({
      readings: dto.readings.map((reading) => ({ ...reading, autoSettle: false })),
    }, actor);
  }

  async list(before?: string) {
    return this.prisma.periodicChargeBatch.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
      ...(before && { cursor: { id: before }, skip: 1 }),
      include: { building: { select: { name: true } } },
    });
  }

  async detail(id: string) {
    const batch = await this.prisma.periodicChargeBatch.findUnique({ where: { id }, include: {
      building: { select: { name: true } },
      items: { orderBy: [{ kind: 'asc' }, { label: 'asc' }, { id: 'asc' }] },
    } });
    if (!batch) throw new NotFoundException('收费批次不存在');
    const billIds = batch.items.flatMap(({ result }) => receiptBillId(result) ?? []);
    const bills = await this.prisma.bill.findMany({
      where: { id: { in: billIds } },
      select: { id: true, status: true, amount: true, paidAmount: true },
    });
    return { ...batch, bills };
  }

  async preview(dto: PreviewPeriodicChargeDto, actor: string) {
    const cutoff = new Date(dto.cutoff);
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(dto.cutoff) || !Number.isFinite(cutoff.getTime()) || cutoff > this.clock.now()) {
      throw new BadRequestException('请指定含时区且不晚于现在的截止时间');
    }
    const period = this.clock.monthKey(cutoff);
    const id = await this.prisma.$transaction(async (tx) => {
      if (!await tx.building.findUnique({ where: { id: dto.buildingId }, select: { id: true } })) {
        throw new NotFoundException('楼栋不存在');
      }
      const [leases, meters] = await Promise.all([
        tx.contract.findMany({
          where: { buildingId: dto.buildingId, status: 'ACTIVE', startDate: { lte: this.clock.todayUtc(cutoff) } },
          select: { id: true, contractNumber: true },
        }),
        tx.meter.findMany({
          where: { buildingId: dto.buildingId, roomId: { not: null }, isActive: true },
          select: { id: true, meterNumber: true },
        }),
      ]);
      const batch = await tx.periodicChargeBatch.create({
        data: { buildingId: dto.buildingId, cutoff, period, createdBy: actor },
      });
      const targets = [
        ...leases.map((lease) => ({ kind: 'RENT', targetId: lease.id, label: lease.contractNumber })),
        ...meters.map((meter) => ({ kind: 'UTILITY', targetId: meter.id, label: meter.meterNumber })),
      ];
      const data = [];
      for (const target of targets) {
        const { review, billId } = await this.check(tx, batch, target);
        data.push({ ...target, batchId: batch.id, ...reviewData(review, billId) });
      }
      if (data.length) await tx.periodicChargeItem.createMany({ data });
      return batch.id;
    }, transaction);
    return this.detail(id);
  }

  async recheck(id: string, version: number) {
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.lockBatch(tx, id, version);
      const items = await tx.periodicChargeItem.findMany({
        where: { batchId: id, state: { in: ['BLOCKED', 'FAILED', 'READY'] } },
      });
      for (const item of items) {
        const { review, billId } = await this.check(tx, batch, item);
        await tx.periodicChargeItem.update({ where: { id: item.id }, data: reviewData(review, billId) });
      }
      await tx.periodicChargeBatch.update({ where: { id }, data: { version: { increment: 1 } } });
    }, transaction);
    return this.detail(id);
  }

  async confirm(id: string, version: number, actor: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockBatch(tx, id, version);
      const queued = await tx.periodicChargeItem.updateMany({
        where: { batchId: id, state: 'READY' },
        data: { state: 'QUEUED', result: Prisma.DbNull },
      });
      if (!queued.count) throw new ConflictException('没有可以确认的项目，请重新检查异常');
      await tx.periodicChargeBatch.update({
        where: { id },
        data: { confirmedBy: actor, version: { increment: 1 } },
      });
    }, transaction);
    return this.detail(id);
  }

  async retryNotices(id: string) {
    await this.prisma.periodicChargeItem.updateMany({
      where: { batchId: id, notificationState: 'FAILED' },
      data: { notificationState: 'PENDING' },
    });
    return this.detail(id);
  }

  private async lockBatch(tx: Tx, id: string, version: number) {
    await tx.$queryRaw`SELECT id FROM periodic_charge_batches WHERE id = ${id} FOR UPDATE`;
    const batch = await tx.periodicChargeBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('收费批次不存在');
    if (batch.version !== version) throw new ConflictException('批次已变化，请刷新');
    if (await tx.periodicChargeItem.count({ where: { batchId: id, state: 'QUEUED' } })) {
      throw new ConflictException('批次执行中，请待当前项目完成');
    }
    return batch;
  }

  private check(tx: Tx, batch: PeriodicChargeBatch, item: Pick<PeriodicChargeItem, 'kind' | 'targetId'>) {
    const { targetId } = item;
    return item.kind === 'RENT' ? reviewRent(tx, this.clock, targetId, batch.buildingId, batch.cutoff)
      : reviewUtility(tx, this.billing, this.clock, targetId, batch.buildingId, batch.cutoff).then((review) => ({ review, billId: undefined }));
  }

  /** SQL queue is authoritative. Lock and financial write share the same PostgreSQL transaction. */
  async processNext() {
    return this.prisma.$transaction(async (tx) => {
      const [next] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM periodic_charge_items WHERE state = 'QUEUED'
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!next) return false;
      const item = await tx.periodicChargeItem.findUniqueOrThrow({ where: { id: next.id }, include: { batch: true } });
      await tx.$executeRaw`SAVEPOINT periodic_charge_item`;
      let receipt: Receipt;
      let userId: string | null = null;
      try {
        const result = await this.execute(tx, item, item.batch);
        receipt = result.receipt;
        userId = result.userId;
      } catch (error) {
        // Keep the queue row claimed while rolling back only the financial attempt.
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT periodic_charge_item`;
        if (error instanceof ChangedDuringCharge) {
          receipt = stale();
        } else {
          this.logger.error(`周期收费执行失败 item=${item.id}`, error instanceof Error ? error.stack : undefined);
          receipt = { state: 'FAILED', reasonCode: 'CHARGE_FAILED', amount: 0, reason: '执行失败，费用未提交',
            retryCondition: '排除故障后重新检查此项目' };
        }
      }
      await tx.$executeRaw`RELEASE SAVEPOINT periodic_charge_item`;
      await tx.periodicChargeItem.update({ where: { id: item.id }, data: {
        state: receipt.state, result: compactReceipt({ ...receipt, confirmedBy: item.batch.confirmedBy ?? undefined }), attempts: { increment: 1 },
        notificationUserId: userId, notificationState: userId ? 'PENDING' : null,
      } });
      return true;
    }, transaction);
  }

  private async execute(tx: Tx, item: PeriodicChargeItem, batch: PeriodicChargeBatch): Promise<{ receipt: Receipt; userId: string | null }> {
    const expected = item.review as ChargeReview;
    if (!batch.confirmedBy) throw new Error('排队项目缺确认人');
    if (item.kind === 'RENT') {
      const lease = await tx.contract.findUnique({ where: { id: item.targetId }, select: { roomId: true } });
      if (lease) await lockLeaseRoom(tx, lease.roomId);
      const plan = await reviewRent(tx, this.clock, item.targetId, batch.buildingId, batch.cutoff);
      if (plan.review.state !== 'READY' || !plan.quote) return { receipt: reviewReceipt(plan.review, plan.billId), userId: null };
      if (plan.review.fingerprint !== expected.fingerprint) return { receipt: stale(), userId: null };
      const dedupKey = rentBillDedupKey(item.targetId, plan.quote.period);
      const created = await tx.bill.createMany({ skipDuplicates: true, data: [{
        ...plan.quote, contractId: item.targetId, billNumber: `B${Date.now()}${randomHex(3)}`, billType: 'RENT', dedupKey,
        snapshot: { ...plan.quote.snapshot, periodicChargeItemId: item.id, operatorId: batch.confirmedBy },
      }] });
      const bill = await tx.bill.findUniqueOrThrow({ where: { dedupKey }, select: { id: true } });
      return {
        receipt: { state: created.count ? 'SETTLED' : 'NO_CHANGE', reasonCode: created.count ? 'BILL_CREATED' : 'ALREADY_BILLED',
          amount: created.count ? plan.review.amount : 0, billId: bill.id },
        userId: created.count ? plan.userId ?? null : null,
      };
    }

    await lockMeters(tx, [item.targetId]);
    const review = await reviewUtility(tx, this.billing, this.clock, item.targetId, batch.buildingId, batch.cutoff);
    if (review.state !== 'READY') return { receipt: review, userId: null };
    if (review.fingerprint !== expected.fingerprint) return { receipt: stale(), userId: null };
    const result = await this.billing.settleMeterInTransaction(tx, item.targetId, batch.cutoff, batch.confirmedBy);
    if (result.status === 'SETTLED' && (result.amount !== expected.amount || result.contractId !== expected.contractId)) {
      throw new ChangedDuringCharge();
    }
    const lease = result.contractId
      ? await tx.contract.findUnique({ where: { id: result.contractId }, select: { tenant: { select: { userId: true } } } })
      : null;
    return {
      receipt: { state: result.status, reasonCode: result.reasonCode, reason: result.reason, retryCondition: result.retryCondition,
        amount: result.status === 'SETTLED' ? result.amount : 0, billId: result.billId, prepayTransactionId: result.prepayTransactionId },
      userId: result.status === 'SETTLED' ? lease?.tenant.userId ?? null : null,
    };
  }

  /** The durable notice state commits with the charge; this phase never writes billing data. */
  async deliverPending() {
    const items = await this.prisma.periodicChargeItem.findMany({
      where: { notificationState: 'PENDING' }, take: 25, orderBy: { id: 'asc' },
    });
    for (const item of items) {
      try {
        const notice = await this.notifications.create({
          userId: item.notificationUserId!,
          title: '周期收费已处理',
          body: `项目 ${item.label} 已处理，请查看账单或预付账户流水。`,
          dedupKey: `PERIODIC_CHARGE:${item.id}`,
          data: { billId: receiptBillId(item.result), itemId: item.id },
        });
        if (!notice || typeof notice !== 'object' || !('id' in notice) || typeof notice.id !== 'string') {
          throw new Error('未取得站内通知凭证');
        }
        await this.prisma.periodicChargeItem.updateMany({
          where: { id: item.id, notificationState: { in: ['PENDING', 'FAILED'] } },
          data: { notificationId: notice.id, notificationState: 'DELIVERED' },
        });
      } catch (error) {
        this.logger.warn(`周期收费站内通知失败 item=${item.id}: ${error instanceof Error ? error.message : String(error)}`);
        await this.prisma.periodicChargeItem.updateMany({
          where: { id: item.id, notificationState: 'PENDING' }, data: { notificationState: 'FAILED' },
        });
      }
    }
  }

  @Cron('*/15 * * * * *', { name: 'periodic-charge-batches', waitForCompletion: true })
  async drain() {
    try {
      for (let i = 0; i < 25; i++) {
        if (!await this.processNext()) break;
      }
    } finally {
      await this.deliverPending();
    }
  }
}

function receiptBillId(data: Prisma.JsonValue): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return typeof data.billId === 'string' ? data.billId : undefined;
}

function reviewReceipt(review: ChargeReview, billId?: string): Receipt {
  const { state, reasonCode, reason, retryCondition, amount } = review;
  return { state, reasonCode, reason, retryCondition, amount, billId };
}

function compactReceipt(receipt: Receipt): Prisma.InputJsonObject {
  const { state, reasonCode, reason, retryCondition, amount, billId, prepayTransactionId, confirmedBy } = receipt;
  return { state, reasonCode, amount, ...(reason && { reason }), ...(retryCondition && { retryCondition }),
    ...(billId && { billId }), ...(prepayTransactionId && { prepayTransactionId }), ...(confirmedBy && { confirmedBy }) };
}

function reviewData(review: ChargeReview, billId?: string) {
  return { state: review.state, review, result: review.state === 'READY' ? Prisma.DbNull : compactReceipt(reviewReceipt(review, billId)) };
}
