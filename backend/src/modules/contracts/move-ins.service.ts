import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { BillType, Contract, Prisma } from '@prisma/client';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { rentBillDedupKey } from '../../common/utils/duplicate-keys.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { lockBillForWrite } from '../bills/bill-write-lock.js';
import { realMeterReadings } from '../meters/meter-reading-scope.js';
import { findMeterSettlementCursor, lockMeters, METER_WRITE_TRANSACTION } from '../meters/meter-settlement-state.js';
import { resolveMeterUsageOwner } from '../meters/meter-usage-attribution.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CYCLE_MONTHS, quoteRentCycle, RENT_ROUNDING } from '../scheduler/rent-charge.js';
import { getBusinessDateParts } from '../scheduler/scheduler.util.js';
import { activateConfirmedLease, lockLeaseRoom } from './contract-activation.js';
import { ContractsService } from './contracts.service.js';
import type { ConfirmMoveInDto, MoveInLeaseDto } from './dto/move-in.dto.js';

interface MoveInBill {
  billType: BillType;
  period: string;
  amount: number;
  dueDate: Date;
  snapshot: Prisma.InputJsonObject;
}

@Injectable()
export class MoveInsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly clock: BusinessClock,
  ) {}

  async preview(roomId: string, dto: MoveInLeaseDto) {
    const plan = await this.loadPlan(this.prisma, roomId, dto, this.clock.todayUtc());
    return {
      reviewToken: plan.reviewToken,
      meters: plan.meters,
      bills: plan.bills.map(({ billType, period, amount, dueDate }) => ({ billType, period, amount, dueDate })),
      tenantName: plan.tenantName,
    };
  }

  async confirm(roomId: string, dto: ConfirmMoveInDto, operatorId: string) {
    const ordered = [...dto.readings].sort((a, b) => a.meterId.localeCompare(b.meterId));
    const payloadHash = hash({ ...dto, roomId, readings: ordered });
    return this.prisma.$transaction(async (tx) => {
      // Serialize the same request even when it is sent with conflicting room IDs.
      await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${dto.requestId}, 0))`;
      const existing = await tx.moveInRequest.findUnique({ where: { requestId: dto.requestId } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException('同一入住请求编号不能提交不同资料');
        return existing.result;
      }

      await lockLeaseRoom(tx, roomId);
      const occupiedAt = this.clock.now();
      const today = this.clock.todayUtc(occupiedAt);
      const plan = await this.loadPlan(tx, roomId, dto, today);
      if (plan.reviewToken !== dto.reviewToken) throw new ConflictException('入住资料已变化，请重新预览');
      if (ordered.length !== plan.meters.length || ordered.some((reading, index) => reading.meterId !== plan.meters[index].id)) {
        throw new BadRequestException('请为房间的每个启用表计提供一笔底数');
      }
      await lockMeters(tx, ordered.map(({ meterId }) => meterId));

      let lease = plan.lease ?? await this.contracts.createDraft(dto.contract!, tx);
      if (lease.status === 'DRAFT') {
        if (!lease.leaseConfirmedAt) {
          lease = await tx.contract.update({
            where: { id: lease.id },
            data: { leaseConfirmedAt: occupiedAt, leaseConfirmedBy: operatorId },
          });
        }
        if (!await activateConfirmedLease(tx, lease, today)) {
          throw new ConflictException('租约尚不能生效，请核对房源上原租约及起租日期');
        }
      }

      const billIds = [];
      for (const bill of plan.bills) {
        billIds.push(await this.writeBill(tx, lease, bill));
      }
      const account = await tx.prepayAccount.upsert({
        where: { tenantId_roomId: { tenantId: lease.tenantId, roomId } },
        create: { tenantId: lease.tenantId, roomId },
        update: {},
        select: { id: true },
      });

      await tx.moveInRequest.create({
        data: { requestId: dto.requestId, contractId: lease.id, occupiedAt, operatorId, payloadHash, result: {} },
      });
      const hasHistory = await tx.contract.findFirst({
        where: { roomId, id: { not: lease.id }, status: { not: 'DRAFT' } },
        select: { id: true },
      });
      const baselines = [];
      for (const reading of ordered) {
        const baseline = await this.writeBaseline(tx, roomId, reading, occupiedAt, operatorId, Boolean(hasHistory));
        baselines.push({ meterId: reading.meterId, readingId: baseline.id, currentReading: reading.currentReading });
      }
      const room = await tx.room.update({
        where: { id: roomId, version: plan.room.version },
        data: { status: 'OCCUPIED', version: { increment: 1 } },
        select: { id: true, version: true, status: true },
      });
      const result = {
        requestId: dto.requestId, contractId: lease.id, occupiedAt: occupiedAt.toISOString(),
        billIds, prepayAccountId: account.id, baselines, room,
      };
      await tx.moveInRequest.update({ where: { requestId: dto.requestId }, data: { result } });
      return result;
    }, METER_WRITE_TRANSACTION);
  }

  private async loadPlan(db: Prisma.TransactionClient, roomId: string, dto: MoveInLeaseDto, today: Date) {
    if (Boolean(dto.contractId) === Boolean(dto.contract)) throw new BadRequestException('请选择现有合同或填写新合同');
    const room = await db.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房源不存在');
    if ((room.status !== 'VACANT' && room.status !== 'RESERVED') || room.cleanStatus !== 'CLEAN') {
      throw new ConflictException('办理入住要求房间空置或预留且已清洁');
    }
    const lease = dto.contractId ? await db.contract.findUnique({ where: { id: dto.contractId } }) : null;
    if (dto.contractId && !lease) throw new NotFoundException('合同不存在');
    const terms = lease ?? dto.contract!;
    if (terms.roomId !== room.id || terms.buildingId !== room.buildingId) {
      throw new BadRequestException('租约与所选房间或楼栋不一致');
    }
    if (lease && (lease.status !== 'DRAFT' && (lease.status !== 'ACTIVE' || !lease.leaseConfirmedAt))) {
      throw new ConflictException('请选择草稿或已确认生效的合同');
    }
    if (lease?.renewedFromId) throw new ConflictException('续签请使用租约续签确认流程');
    const start = typeof terms.startDate === 'string' ? this.clock.parseDateOnly(terms.startDate) : terms.startDate;
    const end = typeof terms.endDate === 'string' ? this.clock.parseDateOnly(terms.endDate) : terms.endDate;
    if (!start || !end || !(start < end && start <= today && end >= today)) {
      throw new ConflictException('实际入住时间须在有效租期内');
    }

    const [tenant, meters] = await Promise.all([
      db.tenant.findUnique({ where: { id: terms.tenantId }, select: { name: true } }),
      db.meter.findMany({
        where: { roomId, isActive: true },
        select: { id: true, meterNumber: true, meterType: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    if (!tenant) throw new NotFoundException('租客不存在');
    const bills = this.quoteBills(terms, start, end);
    const reviewToken = hash({ roomId, version: room.version, lease: lease ? { id: lease.id, updatedAt: lease.updatedAt } : dto.contract, meters, bills });
    return { room, lease, bills, meters, reviewToken, tenantName: tenant.name };
  }

  private quoteBills(
    terms: Pick<Contract, 'rentAmount' | 'paymentCycle' | 'paymentDay' | 'depositAmount'>,
    start: Date,
    end: Date,
  ): MoveInBill[] {
    const startParts = getBusinessDateParts(start);
    const quote = quoteRentCycle({
      monthlyRent: terms.rentAmount, contractStart: startParts, contractEnd: getBusinessDateParts(end),
      anchorYear: startParts.year, anchorMonth: startParts.month, cycleMonths: CYCLE_MONTHS[terms.paymentCycle],
    });
    const bills: MoveInBill[] = [];
    if (quote && quote.amount > 0) {
      bills.push({
        billType: 'RENT', period: quote.period, amount: quote.amount,
        dueDate: new Date(Date.UTC(startParts.year, startParts.month - 1, Math.min(terms.paymentDay, 28))),
        snapshot: {
          rentAmount: terms.rentAmount, cycle: terms.paymentCycle, periodStart: quote.periodStart,
          periodEnd: quote.periodEnd, rounding: RENT_ROUNDING, months: quote.months.map((month) => ({ ...month })),
          paymentDay: terms.paymentDay,
        },
      });
    }
    if (terms.depositAmount > 0) {
      bills.push({
        billType: 'DEPOSIT', period: start.toISOString().slice(0, 7), amount: terms.depositAmount,
        dueDate: start, snapshot: { depositAmount: terms.depositAmount },
      });
    }
    return bills;
  }

  private async writeBill(tx: Prisma.TransactionClient, lease: Contract, bill: MoveInBill) {
    const dedupKey = bill.billType === 'RENT' ? rentBillDedupKey(lease.id, bill.period) : `DEPOSIT:${lease.id}`;
    const where = {
      contractId: lease.id, billType: bill.billType,
      ...(bill.billType === 'RENT' && { period: bill.period }),
    };
    const matches = await tx.bill.findMany({ where, take: 2 });
    if (matches.length > 1) throw new ConflictException('发现多笔现有应收，请先核对账单');
    let existing = matches[0];
    if (existing) {
      await lockBillForWrite(tx, existing.id);
      existing = await tx.bill.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      await tx.bill.createMany({
        data: [{
          ...bill, contractId: lease.id, dedupKey, billNumber: `B${Date.now()}${randomHex(3)}`,
          snapshot: { ...bill.snapshot, contractNumber: lease.contractNumber, origin: 'MOVE_IN' },
        }],
        skipDuplicates: true,
      });
      existing = await tx.bill.findUniqueOrThrow({ where: { dedupKey } });
    }
    if (existing.amount !== bill.amount || existing.status === 'CANCELLED') {
      throw new ConflictException('已存在与入住应收不一致的账单，请先核对');
    }
    return existing.id;
  }

  private async writeBaseline(
    tx: Prisma.TransactionClient, roomId: string, reading: ConfirmMoveInDto['readings'][number],
    occupiedAt: Date, operatorId: string, hasHistory: boolean,
  ) {
    const { meterId, currentReading } = reading;
    const latest = await tx.meterReading.findFirst({
      where: { meterId, ...realMeterReadings(tx) },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });
    const cursor = await findMeterSettlementCursor(tx, meterId);
    const previousReading = Number(latest?.currentReading ?? currentReading);
    if (latest && (latest.id !== cursor?.id || latest.readingTime >= occupiedAt || currentReading < previousReading
      || (latest.handoffRequired && !latest.handoffConfirmedAt))) {
      throw new ConflictException('表计存在未结算用量或异常，请先核对原游标和交接底数');
    }

    const usage = (Math.round(currentReading * 100) - Math.round(previousReading * 100)) / 100;
    if (latest && usage > 0 && hasHistory) {
      const owner = await resolveMeterUsageOwner(tx, this.clock, roomId, latest.readingTime, occupiedAt);
      if (owner.kind !== 'VACANT') throw new ConflictException('无法确认前段为空置用量，请先处理原有结算');
    }
    return tx.meterReading.create({
      data: {
        meterId, currentReading, previousReading, usage, readBy: operatorId,
        source: 'MANUAL', readingTime: occupiedAt, createdAt: occupiedAt,
        settledAt: occupiedAt, settledUsage: usage, settledAmount: 0,
        notes: usage > 0 ? '[SETTLED] [VACANT_USAGE] 入住交接底数' : '[INITIAL] 入住交接底数',
      },
    });
  }
}

function hash(value: unknown) {
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const object = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  });
  return createHash('sha256').update(json).digest('hex');
}
