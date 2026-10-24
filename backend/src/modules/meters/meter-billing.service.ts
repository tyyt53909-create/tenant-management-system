import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { METER_TYPE_LABEL, NOT_SIMULATED } from './meter-types.constants.js';
import { MeterPriceService } from './meter-price.service.js';
import { isSettledReading } from './meter-dedup.util.js';

@Injectable()
export class MeterBillingService {
  private readonly clock: BusinessClock;
  private readonly priceService: MeterPriceService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() clock?: BusinessClock,
    @Optional() priceService?: MeterPriceService,
  ) {
    this.clock = clock ?? new BusinessClock(new ConfigService());
    this.priceService =
      priceService ?? new MeterPriceService(prisma, this.clock);
  }

  /**
   * 讀數扣費：用量 × 生效單價
   * - 有生效合同 + 預付帳戶：先扣盡可用餘額（條件更新防並發），差額 → UTILITY 補繳帳單
   * - 無合同 / 無帳戶 / 公共區域 / 用量為 0：不扣費（返回原因）
   *
   * `unitPrice` 由調用方按讀數業務日期解析後傳入（T274）；缺省時退回表上當前價，
   * 保持既有單元測試與舊調用方可編譯。
   */
  async applyReadingDeduction(
    tx: Prisma.TransactionClient,
    meter: { id: string; meterType: string; meterNumber: string; unitPrice: number; roomId: string | null },
    reading: { id: string; readingTime: Date },
    usage: number,
    operatorId: string,
    unitPrice = meter.unitPrice,
  ) {
    if (!meter.roomId) {
      return { applied: false, reason: '公共区域表按运营成本处理，不扣费', unitPrice };
    }

    const amount = Math.round(usage * unitPrice);
    if (amount <= 0) {
      return { applied: false, reason: '用量为 0，无扣费', unitPrice };
    }

    const contract = await tx.contract.findFirst({
      where: { roomId: meter.roomId, status: 'ACTIVE' },
    });
    if (!contract) {
      return { applied: false, reason: '未找到生效合同，未扣费', unitPrice };
    }

    const account = await tx.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: contract.tenantId, roomId: meter.roomId } },
    });
    if (!account) {
      return { applied: false, reason: '该房间租客无预付账户，未扣费', unitPrice };
    }

    // 先扣盡可用餘額（條件更新防並發透支）
    let deducted = 0;
    if (account.balanceCache > 0) {
      const candidate = Math.min(account.balanceCache, amount);
      const result = await tx.prepayAccount.updateMany({
        where: { id: account.id, balanceCache: { gte: candidate } },
        data: { balanceCache: { decrement: candidate } },
      });
      deducted = result.count > 0 ? candidate : 0;
    }

    let prepayTransaction = null;
    if (account && deducted > 0) {
      const updatedAccount = await tx.prepayAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      const typeLabel = METER_TYPE_LABEL[meter.meterType] ?? '水电费';
      prepayTransaction = await tx.prepayTransaction.create({
        data: {
          accountId: account.id,
          type: 'DEDUCTION',
          amount: -deducted,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: reading.id,
          relatedType: 'METER_READING',
          description: `${this.formatPeriod(reading.readingTime)} ${typeLabel}扣费（${meter.meterNumber}）`,
          operatorId,
        },
      });
    }

    const shortfall = amount - deducted;
    let bill = null;
    if (shortfall > 0) {
      const dueDate = this.clock.addDays(this.clock.todayUtc(reading.readingTime), 7);

      bill = await tx.bill.create({
        data: {
          contractId: contract.id,
          billNumber: `B${Date.now()}${randomHex(3)}`,
          billType: 'UTILITY',
          period: this.formatPeriod(reading.readingTime),
          amount: shortfall,
          dueDate,
          snapshot: {
            meterId: meter.id,
            meterNumber: meter.meterNumber,
            meterType: meter.meterType,
            readingId: reading.id,
            usage,
            unitPrice,
            totalAmount: amount,
            deducted,
            shortfall,
            reason: account ? '预付账户余额不足，补缴差额' : '未开通预付账户，直接生成水电账单',
          },
        },
      });
    }

    return { applied: true, amount, deducted, shortfall, prepayTransaction, bill, unitPrice };
  }

  private formatPeriod(date: Date): string {
    return this.clock.monthKey(date);
  }

  /**
   * 查看水电表未结算用量与预估金额（预览）
   */
  async getUnsettledUsage(meterId: string, settleUntilStr?: string) {
    const meter = await this.prisma.meter.findUnique({
      where: { id: meterId },
      include: {
        room: {
          include: {
            contracts: {
              where: { status: 'ACTIVE' },
              take: 1,
              include: { tenant: { select: { id: true, name: true, phone: true } } },
            },
          },
        },
      },
    });
    if (!meter) throw new NotFoundException('水电表不存在');

    const settleUntil = settleUntilStr ? new Date(settleUntilStr) : new Date();

    const latestReading = await this.prisma.meterReading.findFirst({
      where: {
        meterId,
        readingTime: { lte: settleUntil },
        source: NOT_SIMULATED,
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });

    if (!latestReading) {
      return {
        meterId,
        unsettledUsage: 0,
        estimatedAmount: 0,
        lastSettledReading: 0,
        lastSettledTime: null,
        currentReading: 0,
        readingTime: null,
        hasReadings: false,
      };
    }

    const lastSettledReading = await this.findLastSettledReading(
      this.prisma,
      meterId,
      latestReading.readingTime,
    );

    if (lastSettledReading && lastSettledReading.id === latestReading.id) {
      return {
        meterId,
        unsettledUsage: 0,
        estimatedAmount: 0,
        lastSettledReading: Number(latestReading.currentReading),
        lastSettledTime: latestReading.readingTime,
        currentReading: Number(latestReading.currentReading),
        readingTime: latestReading.readingTime,
        hasReadings: true,
      };
    }

    let baselineVal = 0;
    if (lastSettledReading) {
      baselineVal = Number(lastSettledReading.currentReading);
    } else {
      const earliest = await this.prisma.meterReading.findFirst({
        where: { meterId, source: NOT_SIMULATED },
        orderBy: [{ readingTime: 'asc' }, { createdAt: 'asc' }],
      });
      baselineVal = earliest ? Number(earliest.currentReading) : 0;
    }

    const currentVal = Number(latestReading.currentReading);
    const unsettledUsage = Math.max(0, Math.round((currentVal - baselineVal) * 100) / 100);
    const unitPrice = await this.priceService.resolveUnitPrice(meter, latestReading.readingTime);
    const estimatedAmount = Math.round(unsettledUsage * unitPrice);

    const activeContract = meter.room?.contracts?.[0];
    let prepayBalance: number | null = null;
    if (meter.roomId && activeContract?.tenantId) {
      const account = await this.prisma.prepayAccount.findUnique({
        where: { tenantId_roomId: { tenantId: activeContract.tenantId, roomId: meter.roomId } },
      });
      prepayBalance = account ? account.balanceCache : null;
    }

    return {
      meterId,
      meterNumber: meter.meterNumber,
      meterType: meter.meterType,
      unitPrice,
      roomNumber: meter.room?.roomNumber || '公共区域',
      tenantName: activeContract?.tenant?.name || null,
      prepayBalance,
      lastSettledReading: baselineVal,
      lastSettledTime: lastSettledReading?.readingTime ?? null,
      currentReading: currentVal,
      readingTime: latestReading.readingTime,
      unsettledUsage,
      estimatedAmount,
      targetReadingId: latestReading.id,
      hasReadings: true,
    };
  }

  /**
   * 周期结算指定水电表（采集与结算拆分）
   * 结算上次结算（或初始底数）至截止时间之间的累计用量，生成统一扣费流水或补缴账单
   *
   * T274：
   * - 事务内 `SELECT ... FOR UPDATE` 锁表行，并发结算串行化；
   * - 生效单价按读数业务日期解析，不再用「当前价」重算历史；
   * - 结算结果结构化落库（settledAt/Usage/UnitPrice/Amount），重复结算幂等。
   */
  async settleMeter(meterId: string, dto: SettleMeterDto, operatorId: string) {
    const settleUntil = dto.settleUntil ? new Date(dto.settleUntil) : new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.lockMeter(tx, meterId);

      const meter = await tx.meter.findUnique({ where: { id: meterId } });
      if (!meter) throw new NotFoundException('水电表不存在');

      const latestReading = await tx.meterReading.findFirst({
        where: {
          meterId,
          readingTime: { lte: settleUntil },
          source: NOT_SIMULATED,
        },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      if (!latestReading) {
        throw new BadRequestException('该水电表在指定结算时间前无任何读数记录');
      }

      const lastSettledReading = await this.findLastSettledReading(
        tx,
        meterId,
        latestReading.readingTime,
      );

      if (lastSettledReading && lastSettledReading.id === latestReading.id) {
        return {
          meterId,
          settled: false,
          usage: 0,
          amount: 0,
          reason: '最新读数已结算，无新增未结算用量',
        };
      }

      let baselineVal = 0;
      if (lastSettledReading) {
        baselineVal = Number(lastSettledReading.currentReading);
      } else {
        const earliest = await tx.meterReading.findFirst({
          where: { meterId, source: NOT_SIMULATED },
          orderBy: [{ readingTime: 'asc' }, { createdAt: 'asc' }],
        });
        baselineVal = earliest ? Number(earliest.currentReading) : 0;
      }

      const currentVal = Number(latestReading.currentReading);
      const usage = Math.max(0, Math.round((currentVal - baselineVal) * 100) / 100);
      const unitPrice = await this.priceService.resolveUnitPrice(meter, latestReading.readingTime, tx);
      const amount = Math.round(usage * unitPrice);

      if (usage <= 0) {
        await this.markSettled(tx, latestReading, 0, unitPrice, 0, dto.notes);
        return {
          meterId,
          settled: true,
          usage: 0,
          amount: 0,
          unitPrice,
          deduction: { applied: false, reason: '周期内累计用量为 0' },
        };
      }

      const deduction = await this.applyReadingDeduction(
        tx,
        meter,
        latestReading,
        usage,
        operatorId,
        unitPrice,
      );

      if (!deduction.applied) {
        return {
          meterId,
          settled: false,
          baselineReading: baselineVal,
          currentReading: currentVal,
          usage,
          amount,
          unitPrice,
          deduction,
          reason: deduction.reason || '扣费或账单生成未成功，未标记结算',
        };
      }

      const settledAmount =
        (deduction.deducted ?? 0) + (deduction.shortfall ?? 0);
      await this.markSettled(tx, latestReading, usage, unitPrice, settledAmount, dto.notes);

      return {
        meterId,
        settled: true,
        baselineReading: baselineVal,
        currentReading: currentVal,
        usage,
        amount,
        unitPrice,
        deduction,
      };
    });
  }

  /**
   * 批量周期结算（如按楼栋或表列表）
   */
  async settleBatch(
    dto: { buildingId?: string; meterIds?: string[]; settleUntil?: string; notes?: string },
    operatorId: string,
    settleMeterFn?: (meterId: string, dto: SettleMeterDto, operatorId: string) => Promise<Record<string, unknown>>,
  ) {
    let meterIds = dto.meterIds;
    if (!meterIds || meterIds.length === 0) {
      const where: Prisma.MeterWhereInput = { isActive: true };
      if (dto.buildingId) where.buildingId = dto.buildingId;
      const meters = await this.prisma.meter.findMany({ where, select: { id: true } });
      meterIds = meters.map((m) => m.id);
    }

    const settle = settleMeterFn ?? ((id: string, d: SettleMeterDto, op: string) => this.settleMeter(id, d, op));
    const results: Array<{ meterId?: string; success: boolean; error?: string; [key: string]: unknown }> = [];
    for (const id of meterIds) {
      try {
        const res = await settle(id, { settleUntil: dto.settleUntil, notes: dto.notes }, operatorId);
        results.push({ success: true, ...res });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ meterId: id, success: false, error });
      }
    }

    return {
      total: results.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * 最近一次已结算读数：结构化 `settledAt` 优先，兼容历史备注标记。
   * 查询上界为 `at`，避免把未来已结算读数当成当前基准。
   */
  private async findLastSettledReading(
    db: Pick<Prisma.TransactionClient, 'meterReading'> | PrismaService,
    meterId: string,
    at: Date,
  ) {
    const reading = await db.meterReading.findFirst({
      where: {
        meterId,
        source: NOT_SIMULATED,
        readingTime: { lte: at },
        OR: [
          { settledAt: { not: null } },
          { notes: { contains: '[SETTLED]' } },
          { notes: { contains: '[INITIAL]' } },
        ],
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });
    return reading && isSettledReading(reading) ? reading : null;
  }

  /** 锁住表行，串行化同一块表的结算；行不存在时不阻塞，后续 findUnique 抛 404。 */
  private async lockMeter(tx: Prisma.TransactionClient, meterId: string) {
    await tx.$queryRaw`SELECT "id" FROM "meters" WHERE "id" = ${meterId} FOR UPDATE`;
  }

  /** 写结构化结算字段，同时保留 [SETTLED] 备注供旧报表与历史逻辑识别。 */
  private async markSettled(
    tx: Prisma.TransactionClient,
    reading: { id: string; notes: string | null },
    usage: number,
    unitPrice: number,
    amount: number,
    notes?: string,
  ) {
    const settledTag = `[SETTLED]${notes ? ` 备注:${notes}` : ''}`;
    const updatedNotes = reading.notes ? `${reading.notes} ${settledTag}` : settledTag;
    await tx.meterReading.update({
      where: { id: reading.id },
      data: {
        notes: updatedNotes,
        settledAt: new Date(),
        settledUsage: usage,
        settledUnitPrice: unitPrice,
        settledAmount: amount,
      },
    });
  }
}
