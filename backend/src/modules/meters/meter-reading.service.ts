import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { ReadingSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { buildReadingDedupKey, hasReservedReadingMarker, isUniqueViolation } from './meter-dedup.util.js';
import { findEarliestRealReading, findMeterSettlementCursor, findNextConfirmedHandoff, lockMeters, markMeterReadingSettled, METER_WRITE_TRANSACTION } from './meter-settlement-state.js';
import { FUTURE_READING_MESSAGE, hasLegacySimulationNote, lookupMeterReading, realMeterReadings } from './meter-reading-scope.js';
import type { ConfirmMeterHandoffDto } from './dto/confirm-meter-handoff.dto.js';
import { settlesByDefault } from './meter-types.constants.js';

@Injectable()
export class MeterReadingService {
  /**
   * 扣费与计价服务必填（QLT-02 / T288）。
   * 之前 `?? new MeterBillingService(prisma)` 会在容器漏注册时新建一个没有时钟的实例，
   * 单价按进程本地时区解析，月末结算可能落到错误的业务日。
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: MeterBillingService,
    private readonly priceService: MeterPriceService,
  ) {}

  /**
   * 水電讀數登記（docs/02-数据模型.md §2.14）
   * - 首次读数自动作为初始底数登记（usage=0，不计费）
   * - 支持设备消息去重（messageId / 重复时间读数检测）与乱序延迟上传保护
   * - 支持采集与结算拆分（autoSettle）
   * - 房间关联预付账户时根据单价自动扣费；余额不足差额生成 UTILITY 补缴账单
   */
  async createReading(
    meterId: string,
    dto: Omit<CreateMeterReadingDto, 'source'> & { source?: 'MANUAL' | 'DEVICE' | 'SIMULATED' },
    operatorId: string,
  ) {
    const source = dto.source || 'MANUAL';
    if (hasReservedReadingMarker(dto.notes) || hasReservedReadingMarker(dto.messageId)
      || hasLegacySimulationNote(source, dto.notes)) {
      throw new BadRequestException('备注或消息编号不得包含系统保留的结算标记');
    }
    const receivedAt = new Date();
    const readingTime = dto.readingTime ? new Date(dto.readingTime) : receivedAt;
    const simulated = source === 'SIMULATED';
    if (!simulated && readingTime > receivedAt) {
      throw new BadRequestException({ message: FUTURE_READING_MESSAGE, details: { reasonCode: 'FUTURE_READING' } });
    }
    const shouldAutoSettle = settlesByDefault(source, dto.autoSettle);
    const key = buildReadingDedupKey({
      messageId: dto.messageId,
      readingTime,
      currentReading: dto.currentReading,
      source,
    });
    let dedupKey = key;

    try {
      return await this.prisma.$transaction(async (tx) => {
      await lockMeters(tx, [meterId]);
      const meter = await tx.meter.findUnique({ where: { id: meterId } });

      if (!meter) {
        throw new NotFoundException('水电表不存在');
      }

      if (!meter.isActive) {
        throw new BadRequestException('水电表已停用，不能登记读数');
      }

      // 0. 数据库去重键命中：并发/重投直接返回已有记录（T274）
      const scope = simulated ? { source: 'SIMULATED' as const } : realMeterReadings(tx);
      const lookup = await lookupMeterReading(tx, meterId, key, simulated);
      dedupKey = lookup.dedupKey;
      const existingDedupReading = lookup.existing;
      if (existingDedupReading) {
        return {
          reading: existingDedupReading,
          deduction: { applied: false, reason: '重复读数（去重键已存在），已忽略并返回已有记录' },
        };
      }

      // 1. 消息幂等去重：相同 messageId 重复上传（兼容迁移前的历史记录）
      if (dto.messageId) {
        const msgTag = `[msgId:${dto.messageId}]`;
        const existingMsgReading = await tx.meterReading.findFirst({
          where: {
            meterId,
            ...scope,
            notes: { contains: msgTag },
          },
        });
        if (existingMsgReading) {
          return {
            reading: existingMsgReading,
            deduction: { applied: false, reason: '重复消息（messageId 已存在），已忽略并返回已有记录' },
          };
        }
      }

      // 查询当前最新读数记录
      const latestReadingRecord = await tx.meterReading.findFirst({
        where: { meterId, ...scope },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      // 2. 首次读数 / 初始底数处理
      // 1) 显式声明 isInitial: true
      // 2) 或者当前表无任何历史记录且未显式指定 isInitial: false
      const isInitialBaseline = dto.isInitial === true || (!latestReadingRecord && dto.isInitial !== false);

      if (isInitialBaseline) {
        if (meter.roomId && latestReadingRecord && !simulated) {
          throw new BadRequestException('房间表已有读数，请登记普通交接读数并分段结算');
        }
        const tag = '[INITIAL]';
        let notes = dto.notes ? `${tag} ${dto.notes}` : `${tag} 登记初始底数`;
        if (dto.messageId) notes += ` [msgId:${dto.messageId}]`;

        const reading = await tx.meterReading.create({
          data: {
            meterId,
            currentReading: dto.currentReading,
            previousReading: dto.currentReading,
            usage: 0,
            source: source as ReadingSource,
            readingTime,
            createdAt: receivedAt,
            readBy: operatorId,
            notes,
            dedupKey,
            // 初始底数即结算基准，结构字段一并落库，避免后续把底数当未结算用量（T274）
            ...(!simulated && {
              settledAt: readingTime,
              settledUsage: 0,
              settledUnitPrice: meter.unitPrice,
              settledAmount: 0,
            }),
          },
        });
        return {
          reading,
          deduction: { applied: false, reason: '初始底数登记，不计算用量与扣费' },
        };
      }

      // 3. 数据防重：同一时间戳与读数的设备重复上报
      if (
        latestReadingRecord &&
        dto.readingTime &&
        latestReadingRecord.readingTime.getTime() === readingTime.getTime() &&
        Number(latestReadingRecord.currentReading) === dto.currentReading
      ) {
        return {
          reading: latestReadingRecord,
          deduction: { applied: false, reason: '同一时间戳与读数的设备重复上报，已忽略' },
        };
      }

      // 4. 乱序到达 / 延迟上传防护
      if (latestReadingRecord && readingTime < latestReadingRecord.readingTime) {
        // 检查是否存在完全重复的历史记录
        const duplicateHistorical = await tx.meterReading.findFirst({
          where: {
            meterId,
            ...scope,
            readingTime,
            currentReading: dto.currentReading,
          },
        });
        if (duplicateHistorical) {
          return {
            reading: duplicateHistorical,
            deduction: { applied: false, reason: '同一时间戳与读数的设备重复上报，已忽略' },
          };
        }

        // 检查是否存在逻辑矛盾：在此时间点之后的历史记录，其读数居然低于当前新上报读数（除非允许翻转）
        const handoff = simulated ? undefined : await findNextConfirmedHandoff(tx, meterId, readingTime);
        if (handoff && dto.currentReading > Number(handoff.handoffPreviousFinal) && !dto.allowRollover) {
          throw new BadRequestException('乱序读数异常：当前读数高于旧表交接末数');
        }
        const laterReadingWithLowerValue = await tx.meterReading.findFirst({
          where: {
            meterId,
            ...scope,
            readingTime: { gte: readingTime, ...(handoff && { lt: handoff.readingTime }) },
            currentReading: { lt: dto.currentReading },
          },
        });
        if (laterReadingWithLowerValue && !dto.allowRollover) {
          throw new BadRequestException(
            `乱序读数异常：早于后续记录（时间: ${laterReadingWithLowerValue.readingTime.toISOString()}, 读数: ${laterReadingWithLowerValue.currentReading}）的时间点读数（${dto.currentReading}）高于后续读数`,
          );
        }

        const precedingRecord = await tx.meterReading.findFirst({
          where: {
            meterId,
            ...scope,
            readingTime: { lte: readingTime },
          },
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
        });

        const prevVal = precedingRecord ? Number(precedingRecord.currentReading) : dto.currentReading;
        if (dto.currentReading < prevVal && !dto.allowRollover) {
          throw new BadRequestException(
            `乱序读数异常：当前读数（${dto.currentReading}）小于该时间之前的历史读数（${prevVal}）`,
          );
        }

        const usage = Math.round((dto.currentReading - prevVal) * 100) / 100;
        let notes = `[OUT_OF_ORDER] 延迟乱序上报数据补录${dto.notes ? `；${dto.notes}` : ''}`;
        if (dto.messageId) notes += ` [msgId:${dto.messageId}]`;

        const reading = await tx.meterReading.create({
          data: {
            meterId,
            currentReading: dto.currentReading,
            previousReading: prevVal,
            usage,
            source: source as ReadingSource,
            readingTime,
            createdAt: receivedAt,
            handoffRequired: !simulated && dto.allowRollover === true,
            readBy: operatorId,
            notes,
            dedupKey,
          },
        });

        return {
          reading,
          deduction: { applied: false, reason: '延迟乱序数据已入库归档，不触发即时扣费' },
        };
      }

      // 5. 正常时序读数
      const previousReading = latestReadingRecord ? Number(latestReadingRecord.currentReading) : 0;
      if (dto.currentReading < previousReading && !dto.allowRollover) {
        throw new BadRequestException(
          `当前读数（${dto.currentReading}）不能小于上次读数（${previousReading}）`,
        );
      }

      const usage = Math.round((dto.currentReading - previousReading) * 100) / 100;
      let notes = dto.notes || '';
      if (dto.messageId) notes = notes ? `${notes} [msgId:${dto.messageId}]` : `[msgId:${dto.messageId}]`;

      // 统一结算基准：若开启自动结算，结算基准应为上次已结算读数（避免设备采集后人工抄表漏计前段用量）
      const baseline = shouldAutoSettle
        ? (await findMeterSettlementCursor(tx, meterId)) ?? await findEarliestRealReading(tx, meterId)
        : null;

      const reading = await tx.meterReading.create({
        data: {
          meterId,
          currentReading: dto.currentReading,
          previousReading,
          usage,
          source: source as ReadingSource,
          readingTime,
          createdAt: receivedAt,
          handoffRequired: !simulated && dto.allowRollover === true,
          readBy: operatorId,
          notes: notes || null,
          dedupKey,
        },
      });

      let deduction: Record<string, unknown> = {
        applied: false,
        reason: simulated ? '模拟读数仅用于模拟报告' : '已采集读数，未开启自动扣费（等待周期结算）',
      };
      if (shouldAutoSettle) {
        const quote = await this.billingService.quoteInterval(tx, meter, baseline, {
          ...reading, currentReading: dto.currentReading, readingTime,
        });
        if ('reasonCode' in quote) {
          return { reading, deduction: { applied: false, ...quote } };
        }
        const charge = await this.billingService.applyReadingDeduction(
          tx, meter, reading, quote.usage, operatorId, baseline, quote.unitPrice, quote,
        );
        deduction = charge;
        const vacancy = charge.reasonCode === 'VACANT_INTERVAL';
        if (charge.applied || vacancy || quote.usage === 0) {
          reading.notes = await markMeterReadingSettled(
            tx, reading, quote.usage, quote.unitPrice, charge.amount ?? 0, undefined, vacancy, quote.segments,
          );
        }
      }

      return { reading, deduction };
    }, METER_WRITE_TRANSACTION);
    } catch (error) {
      // 并发重投：两个请求同时通过前置检查时由唯一约束兜底，返回先落库的那条
      if (isUniqueViolation(error, 'dedupKey')) {
        const scope = simulated ? { source: 'SIMULATED' as const } : realMeterReadings(this.prisma);
        const existing = await this.prisma.meterReading.findFirst({ where: { meterId, dedupKey, ...scope } });
        if (existing) {
          return {
            reading: existing,
            deduction: { applied: false, reason: '重复读数（去重键已存在），已忽略并返回已有记录' },
          };
        }
      }
      throw error;
    }
  }

  async confirmMeterHandoff(meterId: string, readingId: string, dto: ConfirmMeterHandoffDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockMeters(tx, [meterId]);
      const scope = realMeterReadings(tx);
      const reading = await tx.meterReading.findFirst({ where: { id: readingId, meterId, ...scope } });
      if (!reading) throw new NotFoundException('找不到该表计的真实交接读数');
      if (Number(reading.currentReading) !== dto.newOpening) {
        throw new BadRequestException('新表底数必须与这条交接读数一致');
      }
      if (reading.handoffConfirmedAt) {
        if (Number(reading.handoffPreviousFinal) !== dto.previousFinal) {
          throw new BadRequestException('已确认交接，不可覆盖旧表末数');
        }
        return reading;
      }
      const cursor = await findMeterSettlementCursor(tx, meterId);
      if (cursor && cursor.readingTime >= reading.readingTime) {
        throw new BadRequestException('不能修改已结算区间的交接证据');
      }
      const duplicates = await tx.meterReading.count({ where: {
        meterId, ...scope, readingTime: reading.readingTime, id: { not: readingId },
      } });
      if (duplicates > 0) throw new BadRequestException('同一时刻存在多条真实读数，须先核对交接证据');
      const previous = await tx.meterReading.findFirst({
        where: { meterId, ...scope, readingTime: { lt: reading.readingTime } },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });
      if (!previous || dto.previousFinal < Number(previous.currentReading)) {
        throw new BadRequestException('缺少旧表底数，或旧表末数低于交接前读数');
      }

      const previousReading = Number(previous.currentReading);
      return tx.meterReading.update({
        where: { id: reading.id },
        data: {
          handoffRequired: true,
          handoffPreviousFinal: dto.previousFinal,
          handoffConfirmedBy: operatorId,
          handoffConfirmedAt: new Date(),
          previousReading,
          usage: (Math.round(dto.previousFinal * 100) - Math.round(previousReading * 100)) / 100,
        },
      });
    }, METER_WRITE_TRANSACTION);
  }

  /**
   * 讀數歷史（分頁，按讀數時間倒序）
   */
  async findReadings(meterId: string, query: QueryMeterReadingsDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = { meterId, ...realMeterReadings(this.prisma) };
    const [data, total] = await Promise.all([
      this.prisma.meterReading.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.meterReading.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
