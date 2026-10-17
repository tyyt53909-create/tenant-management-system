import { Injectable, Optional } from '@nestjs/common';
import type { Prisma, ReadingSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { MeterBillingService } from './meter-billing.service.js';
import { settlesByDefault } from './meter-types.constants.js';

@Injectable()
export class MeterBatchReadingService {
  private readonly billingService: MeterBillingService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() billingService?: MeterBillingService,
  ) {
    this.billingService = billingService ?? new MeterBillingService(prisma);
  }

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
      error?: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.readings) {
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

        const readingTime = item.readingTime ? new Date(item.readingTime) : new Date();
        const source = item.source || 'MANUAL';

        // 幂等去重 1: messageId
        if (item.messageId) {
          const msgTag = `[msgId:${item.messageId}]`;
          const existingMsgReading = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
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
          where: { meterId: item.meterId },
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
        });

        // 初始底数处理
        const isInitialBaseline = item.isInitial === true || (!latestReadingRecord && item.isInitial !== false);
        if (isInitialBaseline) {
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
              readBy: operatorId,
              notes,
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
          const laterReadingWithLowerValue = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
              readingTime: { gte: readingTime },
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
              readBy: operatorId,
              notes,
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

        let billableUsage = usage;
        if (shouldAutoSettle) {
          const lastSettledReading = await tx.meterReading.findFirst({
            where: {
              meterId: item.meterId,
              OR: [
                { notes: { contains: '[SETTLED]' } },
                { notes: { contains: '[INITIAL]' } },
              ],
            },
            orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
          });
          const settleBaseline = lastSettledReading
            ? Number(lastSettledReading.currentReading)
            : previousReading;
          billableUsage = Math.max(0, Math.round((item.currentReading - settleBaseline) * 100) / 100);
        }

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
            readBy: operatorId,
            notes: notes || null,
          },
        });

        let deduction: { applied?: boolean; amount?: number; deducted?: number; shortfall?: number; reason?: string } = { applied: false, amount: 0, deducted: 0, shortfall: 0 };
        if (shouldAutoSettle) {
          deduction = await this.billingService.applyReadingDeduction(tx, meter, reading, billableUsage, operatorId);
          if (deduction.applied || billableUsage === 0) {
            const settledNotes = reading.notes ? `${reading.notes} [SETTLED]` : '[SETTLED]';
            await tx.meterReading.update({
              where: { id: reading.id },
              data: { notes: settledNotes },
            });
            reading.notes = settledNotes;
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
          amount: deduction.amount || 0,
          deducted: deduction.deducted || 0,
          shortfall: deduction.shortfall || 0,
        });
      }
    });

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
