import { Injectable } from '@nestjs/common';
import type { Prisma, ReadingSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { buildReadingDedupKey, hasReservedReadingMarker } from './meter-dedup.util.js';
import { findEarliestRealReading, findMeterSettlementCursor, findNextConfirmedHandoff, lockMeters, markMeterReadingSettled, METER_WRITE_TRANSACTION } from './meter-settlement-state.js';
import { FUTURE_READING_MESSAGE, hasLegacySimulationNote, lookupMeterReading, realMeterReadings } from './meter-reading-scope.js';
import { settlesByDefault } from './meter-types.constants.js';

@Injectable()
export class MeterBatchReadingService {
  /** 依赖必填（QLT-02 / T288）：批量抄表与单表抄表必须走同一套计价与时钟。 */
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: MeterBillingService,
    private readonly priceService: MeterPriceService,
  ) {}

  /**
   * 批量抄表工作台底表查询（平铺展示各房源水电表、最新读数及预付余额）
   */
  async getBatchSheet(query: QueryBatchSheetDto) {
    const where: Prisma.MeterWhereInput = { isActive: true };
    if (query.buildingId) {
      where.buildingId = query.buildingId;
    }
    if (query.meterType) {
      where.meterType = query.meterType;
    }
    if (query.floor !== undefined) {
      where.room = { floor: Number(query.floor) };
    }

    const meters = await this.prisma.meter.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        room: {
          select: {
            id: true,
            roomNumber: true,
            floor: true,
            status: true,
            contracts: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: {
                id: true,
                tenantId: true,
                tenant: { select: { id: true, name: true, phone: true } },
              },
            },
          },
        },
        readings: {
          where: realMeterReadings(this.prisma),
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            currentReading: true,
            previousReading: true,
            usage: true,
            readingTime: true,
          },
        },
      },
      orderBy: [
        { buildingId: 'asc' },
        { room: { floor: 'asc' } },
        { room: { roomNumber: 'asc' } },
        { meterType: 'asc' },
      ],
    });

    // 批量查出活跃预付账户余额
    const roomTenantPairs = meters
      .filter((m) => m.roomId && m.room?.contracts?.[0]?.tenantId)
      .map((m) => ({
        roomId: m.roomId!,
        tenantId: m.room!.contracts[0].tenantId,
      }));

    const prepayAccounts = roomTenantPairs.length > 0
      ? await this.prisma.prepayAccount.findMany({
          where: {
            OR: roomTenantPairs.map((p) => ({
              roomId: p.roomId,
              tenantId: p.tenantId,
            })),
          },
          select: { roomId: true, tenantId: true, balanceCache: true },
        })
      : [];

    const prepayMap = new Map<string, number>();
    for (const acc of prepayAccounts) {
      prepayMap.set(`${acc.tenantId}_${acc.roomId}`, acc.balanceCache);
    }

    return meters.map((m) => {
      const activeContract = m.room?.contracts?.[0];
      const lastReading = m.readings?.[0];
      const balanceCache = activeContract
        ? prepayMap.get(`${activeContract.tenantId}_${m.roomId}`) ?? 0
        : null;

      return {
        meterId: m.id,
        meterNumber: m.meterNumber,
        meterType: m.meterType,
        unitPrice: m.unitPrice,
        buildingId: m.buildingId,
        buildingName: m.building?.name || '',
        roomId: m.roomId,
        roomNumber: m.room?.roomNumber || '公共区域',
        floor: m.room?.floor ?? null,
        roomStatus: m.room?.status ?? null,
        tenantId: activeContract?.tenant?.id ?? null,
        tenantName: activeContract?.tenant?.name ?? null,
        tenantPhone: activeContract?.tenant?.phone ?? null,
        lastReading: lastReading ? Number(lastReading.currentReading) : 0,
        lastReadingTime: lastReading?.readingTime ?? null,
        lastUsage: lastReading ? Number(lastReading.usage) : 0,
        prepayBalance: balanceCache,
      };
    });
  }

  /**
   * 批量读数登记（行级独立报告 + 事务原子性处理有效行）
   * - 支持初始底数、消息去重、乱序检测与按需扣费
   */
  async createBatchReadings(dto: BatchMeterReadingsDto, operatorId: string) {
    const results: Array<{
      meterId: string;
      meterNumber?: string;
      roomNumber?: string;
      success: boolean;
      currentReading?: number;
      previousReading?: number;
      usage?: number;
      amount?: number;
      deducted?: number;
      shortfall?: number;
      chargeId?: string;
      collectionMode?: string | null;
      providerAmount?: number;
      vacantUsage?: number;
      deductionBlocked?: { reasonCode: string; reason: string; retryCondition: string };
      error?: string;
      reasonCode?: 'FUTURE_READING';
    }> = [];

    const receivedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const scope = realMeterReadings(tx);
      await lockMeters(tx, dto.readings.map(({ meterId }) => meterId));
      for (const item of dto.readings) {
        const source = item.source || 'MANUAL';
        if (hasReservedReadingMarker(item.notes) || hasReservedReadingMarker(item.messageId)
          || hasLegacySimulationNote(source, item.notes)) {
          results.push({ meterId: item.meterId, success: false, error: '备注或消息编号不得包含系统保留的结算标记' });
          continue;
        }
        const meter = await tx.meter.findUnique({
          where: { id: item.meterId },
          include: { room: true },
        });

        if (!meter) {
          results.push({
            meterId: item.meterId,
            success: false,
            error: '水电表不存在',
          });
          continue;
        }

        if (!meter.isActive) {
          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: false,
            error: '水电表已停用',
          });
          continue;
        }

        const readingTime = item.readingTime ? new Date(item.readingTime) : receivedAt;
        if (readingTime > receivedAt) {
          results.push({ meterId: item.meterId, success: false, reasonCode: 'FUTURE_READING', error: FUTURE_READING_MESSAGE });
          continue;
        }
        const key = buildReadingDedupKey({
          messageId: item.messageId,
          readingTime,
          currentReading: item.currentReading,
          source,
        });

        // 幂等去重 0: 数据库去重键（T274）
        const { dedupKey, existing: existingDedupReading } = await lookupMeterReading(tx, item.meterId, key, false);
        if (existingDedupReading) {
          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: true,
            currentReading: Number(existingDedupReading.currentReading),
            previousReading: Number(existingDedupReading.previousReading),
            usage: Number(existingDedupReading.usage),
          });
          continue;
        }

        // 幂等去重 1: messageId（兼容迁移前的历史记录）
        if (item.messageId) {
          const msgTag = `[msgId:${item.messageId}]`;
          const existingMsgReading = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
              ...scope,
              notes: { contains: msgTag },
            },
          });
          if (existingMsgReading) {
            results.push({
              meterId: item.meterId,
              meterNumber: meter.meterNumber,
              roomNumber: meter.room?.roomNumber,
              success: true,
              currentReading: Number(existingMsgReading.currentReading),
              previousReading: Number(existingMsgReading.previousReading),
              usage: Number(existingMsgReading.usage),
            });
            continue;
          }
        }

        const latestReadingRecord = await tx.meterReading.findFirst({
          where: { meterId: item.meterId, ...scope },
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
        });

        // 初始底数处理
        const isInitialBaseline = item.isInitial === true || (!latestReadingRecord && item.isInitial !== false);
        if (isInitialBaseline) {
          if (meter.roomId && latestReadingRecord) {
            results.push({ meterId: meter.id, success: false, error: '房间表已有读数，请登记普通交接读数并分段结算' });
            continue;
          }
          let notes = `[INITIAL]${item.notes ? ` ${item.notes}` : ' 登记初始底数'}`;
          if (item.messageId) notes += ` [msgId:${item.messageId}]`;

          await tx.meterReading.create({
            data: {
              meterId: item.meterId,
              currentReading: item.currentReading,
              previousReading: item.currentReading,
              usage: 0,
              source: source as ReadingSource,
              readingTime,
              createdAt: receivedAt,
              readBy: operatorId,
              notes,
              dedupKey,
              settledAt: readingTime,
              settledUsage: 0,
              settledUnitPrice: meter.unitPrice,
              settledAmount: 0,
            },
          });

          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: true,
            currentReading: item.currentReading,
            previousReading: item.currentReading,
            usage: 0,
            amount: 0,
            deducted: 0,
            shortfall: 0,
          });
          continue;
        }

        // 幂等防重 2: 完全相同 (meterId, readingTime, currentReading)
        if (
          latestReadingRecord &&
          item.readingTime &&
          latestReadingRecord.readingTime.getTime() === readingTime.getTime() &&
          Number(latestReadingRecord.currentReading) === item.currentReading
        ) {
          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: true,
            currentReading: Number(latestReadingRecord.currentReading),
            previousReading: Number(latestReadingRecord.previousReading),
            usage: Number(latestReadingRecord.usage),
          });
          continue;
        }

        // 乱序延迟上传防护
        if (latestReadingRecord && readingTime < latestReadingRecord.readingTime) {
          const handoff = await findNextConfirmedHandoff(tx, item.meterId, readingTime);
          if (handoff && item.currentReading > Number(handoff.handoffPreviousFinal) && !item.allowRollover) {
            results.push({ meterId: item.meterId, success: false, error: '乱序读数异常：当前读数高于旧表交接末数' });
            continue;
          }
          const laterReadingWithLowerValue = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
              ...scope,
              readingTime: { gte: readingTime, ...(handoff && { lt: handoff.readingTime }) },
              currentReading: { lt: item.currentReading },
            },
          });
          if (laterReadingWithLowerValue && !item.allowRollover) {
            results.push({
              meterId: item.meterId,
              meterNumber: meter.meterNumber,
              roomNumber: meter.room?.roomNumber,
              success: false,
              currentReading: item.currentReading,
              error: `乱序读数异常：早于后续记录的时间点读数(${item.currentReading})高于后续读数`,
            });
            continue;
          }

          const precedingRecord = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
              ...scope,
              readingTime: { lte: readingTime },
            },
            orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
          });

          const prevVal = precedingRecord ? Number(precedingRecord.currentReading) : item.currentReading;
          if (item.currentReading < prevVal && !item.allowRollover) {
            results.push({
              meterId: item.meterId,
              meterNumber: meter.meterNumber,
              roomNumber: meter.room?.roomNumber,
              success: false,
              currentReading: item.currentReading,
              error: `乱序读数异常：当前读数(${item.currentReading})小于该时间之前的历史读数(${prevVal})`,
            });
            continue;
          }

          const usage = Math.round((item.currentReading - prevVal) * 100) / 100;
          let notes = `[OUT_OF_ORDER] 延迟乱序上报数据补录${item.notes ? `；${item.notes}` : ''}`;
          if (item.messageId) notes += ` [msgId:${item.messageId}]`;

          await tx.meterReading.create({
            data: {
              meterId: item.meterId,
              currentReading: item.currentReading,
              previousReading: prevVal,
              usage,
              source: source as ReadingSource,
              readingTime,
              createdAt: receivedAt,
              handoffRequired: item.allowRollover === true,
              readBy: operatorId,
              notes,
              dedupKey,
            },
          });

          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: true,
            currentReading: item.currentReading,
            previousReading: prevVal,
            usage,
            amount: 0,
            deducted: 0,
            shortfall: 0,
          });
          continue;
        }

        // 正常时序读数
        const previousReading = latestReadingRecord ? Number(latestReadingRecord.currentReading) : 0;
        if (item.currentReading < previousReading && !item.allowRollover) {
          results.push({
            meterId: item.meterId,
            meterNumber: meter.meterNumber,
            roomNumber: meter.room?.roomNumber,
            success: false,
            currentReading: item.currentReading,
            previousReading,
            error: `当前读数(${item.currentReading})不能小于上次读数(${previousReading})`,
          });
          continue;
        }

        const usage = Math.round((item.currentReading - previousReading) * 100) / 100;
        const shouldAutoSettle = settlesByDefault(source, item.autoSettle);

        const baseline = shouldAutoSettle
          ? (await findMeterSettlementCursor(tx, meter.id)) ?? await findEarliestRealReading(tx, meter.id)
          : null;

        let notes = item.notes || '';
        if (item.messageId) notes = notes ? `${notes} [msgId:${item.messageId}]` : `[msgId:${item.messageId}]`;

        const reading = await tx.meterReading.create({
          data: {
            meterId: item.meterId,
            currentReading: item.currentReading,
            previousReading,
            usage,
            source: source as ReadingSource,
            readingTime,
            createdAt: receivedAt,
            handoffRequired: item.allowRollover === true,
            readBy: operatorId,
            notes: notes || null,
            dedupKey,
          },
        });

        let deduction: Awaited<ReturnType<MeterBillingService['applyReadingDeduction']>> | undefined;
        let intervalBlock: { reasonCode: string; reason: string; retryCondition: string } | undefined;
        let billableUsage = 0;
        if (shouldAutoSettle) {
          const quote = await this.billingService.quoteInterval(tx, meter, baseline, {
            ...reading, currentReading: item.currentReading, readingTime,
          });
          if ('reasonCode' in quote) {
            intervalBlock = quote;
          } else {
            billableUsage = quote.usage;
            deduction = await this.billingService.applyReadingDeduction(
              tx, meter, reading, billableUsage, operatorId, baseline, quote.unitPrice, quote,
            );
            const vacancy = deduction.reasonCode === 'VACANT_INTERVAL';
            if (deduction.applied || vacancy || billableUsage === 0) {
              await markMeterReadingSettled(
                tx, reading, billableUsage, quote.unitPrice, deduction.amount ?? 0, undefined, vacancy, quote.segments,
              );
            }
          }
        }

        results.push({
          meterId: item.meterId,
          meterNumber: meter.meterNumber,
          roomNumber: meter.room?.roomNumber,
          success: true,
          currentReading: item.currentReading,
          previousReading,
          usage,
          amount: deduction?.amount ?? 0,
          chargeId: deduction?.chargeId, collectionMode: deduction?.collectionMode, providerAmount: deduction?.providerAmount ?? 0,
          deducted: deduction?.deducted ?? 0,
          shortfall: deduction?.shortfall ?? 0,
          ...(deduction?.reasonCode === 'VACANT_INTERVAL' && { vacantUsage: billableUsage }),
          ...(intervalBlock && { deductionBlocked: intervalBlock }),
          ...(deduction?.retryCondition && {
            deductionBlocked: {
              reasonCode: deduction.reasonCode,
              reason: deduction.reason,
              retryCondition: deduction.retryCondition,
            },
          }),
        });
      }
    }, METER_WRITE_TRANSACTION);

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return {
      total: results.length,
      successCount,
      failureCount,
      results,
    };
  }
}
