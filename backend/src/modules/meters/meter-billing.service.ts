import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { METER_TYPE_LABEL, NOT_SIMULATED } from './meter-types.constants.js';

@Injectable()
export class MeterBillingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 讀數扣費：用量 × 當前單價
   * - 有生效合同 + 預付帳戶：先扣盡可用餘額（條件更新防並發），差額 → UTILITY 補繳帳單
   * - 無合同 / 無帳戶 / 公共區域 / 用量為 0：不扣費（返回原因）
   */
  async applyReadingDeduction(
    tx: Prisma.TransactionClient,
    meter: { id: string; meterType: string; meterNumber: string; unitPrice: number; roomId: string | null },
    reading: { id: string; readingTime: Date },
    usage: number,
    operatorId: string,
  ) {
    if (!meter.roomId) {
      return { applied: false, reason: '公共区域表按运营成本处理，不扣费' };
    }

    const amount = Math.round(usage * meter.unitPrice);
    if (amount <= 0) {
      return { applied: false, reason: '用量为 0，无扣费' };
    }

    const contract = await tx.contract.findFirst({
      where: { roomId: meter.roomId, status: 'ACTIVE' },
    });
    if (!contract) {
      return { applied: false, reason: '未找到生效合同，未扣费' };
    }

    const account = await tx.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: contract.tenantId, roomId: meter.roomId } },
    });
    if (!account) {
      return { applied: false, reason: '该房间租客无预付账户，未扣费' };
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
      const dueDate = new Date(reading.readingTime);
      dueDate.setDate(dueDate.getDate() + 7);

      bill = await tx.bill.create({
        data: {
          contractId: contract.id,
          billNumber: `B${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
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
            unitPrice: meter.unitPrice,
            totalAmount: amount,
            deducted,
            shortfall,
            reason: account ? '预付账户余额不足，补缴差额' : '未开通预付账户，直接生成水电账单',
          },
        },
      });
    }

    return { applied: true, amount, deducted, shortfall, prepayTransaction, bill };
  }

  private formatPeriod(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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

    const lastSettledReading = await this.prisma.meterReading.findFirst({
      where: {
        meterId,
        readingTime: { lte: latestReading.readingTime },
        source: NOT_SIMULATED,
        OR: [
          { notes: { contains: '[SETTLED]' } },
          { notes: { contains: '[INITIAL]' } },
        ],
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });

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
    const estimatedAmount = Math.round(unsettledUsage * meter.unitPrice);

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
      unitPrice: meter.unitPrice,
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
   */
  async settleMeter(meterId: string, dto: SettleMeterDto, operatorId: string) {
    const settleUntil = dto.settleUntil ? new Date(dto.settleUntil) : new Date();

    return this.prisma.$transaction(async (tx) => {
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

      const lastSettledReading = await tx.meterReading.findFirst({
        where: {
          meterId,
          readingTime: { lte: latestReading.readingTime },
          source: NOT_SIMULATED,
          OR: [
            { notes: { contains: '[SETTLED]' } },
            { notes: { contains: '[INITIAL]' } },
          ],
        },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

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

      if (usage <= 0) {
        await tx.meterReading.update({
          where: { id: latestReading.id },
          data: {
            notes: latestReading.notes ? `${latestReading.notes} [SETTLED]` : '[SETTLED]',
          },
        });
        return {
          meterId,
          settled: true,
          usage: 0,
          amount: 0,
          deduction: { applied: false, reason: '周期内累计用量为 0' },
        };
      }

      const deduction = await this.applyReadingDeduction(tx, meter, latestReading, usage, operatorId);

      if (!deduction.applied) {
        return {
          meterId,
          settled: false,
          baselineReading: baselineVal,
          currentReading: currentVal,
          usage,
          amount: Math.round(usage * meter.unitPrice),
          deduction,
          reason: deduction.reason || '扣费或账单生成未成功，未标记结算',
        };
      }

      const updatedNotes = latestReading.notes
        ? `${latestReading.notes} [SETTLED]${dto.notes ? ` 备注:${dto.notes}` : ''}`
        : `[SETTLED]${dto.notes ? ` 备注:${dto.notes}` : ''}`;

      await tx.meterReading.update({
        where: { id: latestReading.id },
        data: { notes: updatedNotes },
      });

      return {
        meterId,
        settled: true,
        baselineReading: baselineVal,
        currentReading: currentVal,
        usage,
        amount: Math.round(usage * meter.unitPrice),
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
}
