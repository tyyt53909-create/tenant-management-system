import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { ReadingSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { buildReadingDedupKey, hasReservedReadingMarker, isUniqueViolation } from './meter-dedup.util.js';
import { NOT_SIMULATED, settlesByDefault } from './meter-types.constants.js';

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
    if (hasReservedReadingMarker(dto.notes) || hasReservedReadingMarker(dto.messageId)) {
      throw new BadRequestException('备注或消息编号不得包含系统保留的结算标记');
    }
    const readingTime = dto.readingTime ? new Date(dto.readingTime) : new Date();
    const source = dto.source || 'MANUAL';
    const readingScope = source === 'SIMULATED' ? 'SIMULATED' as const : NOT_SIMULATED;
    const assertSimulationReplay = (reading: { readingTime: Date; currentReading: unknown }) => {
      if (source === 'SIMULATED' && (reading.readingTime.getTime() !== readingTime.getTime() || Number(reading.currentReading) !== dto.currentReading)) {
        throw new ConflictException('模拟消息编号已被不同的读数或时间使用');
      }
    };
    // 手工录入默认结算。设备上报和模拟器读数默认只采集。
    const shouldAutoSettle = settlesByDefault(source, dto.autoSettle);
    // 业务去重键：messageId 优先，否则时间+读数+来源摘要（T274）
    const dedupKey = buildReadingDedupKey({
      messageId: dto.messageId,
      readingTime,
      currentReading: dto.currentReading,
      source,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
      // Serialize simulated messages for the same meter before inspecting timestamps.
      if (source === 'SIMULATED') await tx.$queryRaw`SELECT id FROM meters WHERE id = ${meterId} FOR UPDATE`;
      const meter = await tx.meter.findUnique({ where: { id: meterId } });

      if (!meter) {
        throw new NotFoundException('水电表不存在');
      }

      if (!meter.isActive) {
        throw new BadRequestException('水电表已停用，不能登记读数');
      }

      // 0. 数据库去重键命中：并发/重投直接返回已有记录（T274）
      const existingDedupReading = await tx.meterReading.findUnique({
        where: { meterId_dedupKey: { meterId, dedupKey } },
      });
      if (existingDedupReading) {
        if ((existingDedupReading.source === 'SIMULATED') !== (source === 'SIMULATED')) {
          throw new BadRequestException('历史模拟读数的去重键与真实读数冲突，需人工核对');
        }
        assertSimulationReplay(existingDedupReading);
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
            source: readingScope,
            notes: { contains: msgTag },
          },
        });
        if (existingMsgReading) {
          assertSimulationReplay(existingMsgReading);
          return {
            reading: existingMsgReading,
            deduction: { applied: false, reason: '重复消息（messageId 已存在），已忽略并返回已有记录' },
          };
        }
      }

      // 查询当前最新读数记录
      const latestReadingRecord = await tx.meterReading.findFirst({
        where: { meterId, source: readingScope },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      if (source === 'SIMULATED' && latestReadingRecord && readingTime <= latestReadingRecord.readingTime &&
          !(readingTime.getTime() === latestReadingRecord.readingTime.getTime() && Number(latestReadingRecord.currentReading) === dto.currentReading)) {
        throw new BadRequestException('模拟遥测时间必须晚于已有读数');
      }

      // 2. 首次读数 / 初始底数处理
      // 1) 显式声明 isInitial: true
      // 2) 或者当前表无任何历史记录且未显式指定 isInitial: false
      const isInitialBaseline = dto.isInitial === true || (!latestReadingRecord && dto.isInitial !== false);

      if (isInitialBaseline) {
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
            readBy: operatorId,
            notes,
            dedupKey,
            // 初始底数即结算基准，结构字段一并落库，避免后续把底数当未结算用量（T274）
            settledAt: readingTime,
            settledUsage: 0,
            settledUnitPrice: meter.unitPrice,
            settledAmount: 0,
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
            source: readingScope,
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
        const laterReadingWithLowerValue = await tx.meterReading.findFirst({
          where: {
            meterId,
            source: readingScope,
            readingTime: { gte: readingTime },
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
            source: readingScope,
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
      let billableUsage = usage;
      if (shouldAutoSettle) {
        const lastSettledReading = await tx.meterReading.findFirst({
          where: {
            meterId,
            // 结算基准必须排除模拟读数，否则仿真器的 [INITIAL]/[SETTLED] 会成为真实扣费起点（T209）
            source: NOT_SIMULATED,
            OR: [
              { settledAt: { not: null } },
              { notes: { contains: '[SETTLED]' } },
              { notes: { contains: '[INITIAL]' } },
            ],
          },
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
        });
        const settleBaseline = lastSettledReading
          ? Number(lastSettledReading.currentReading)
          : previousReading;
        billableUsage = Math.max(0, Math.round((dto.currentReading - settleBaseline) * 100) / 100);
      }

      const reading = await tx.meterReading.create({
        data: {
          meterId,
          currentReading: dto.currentReading,
          previousReading,
          usage,
          source: source as ReadingSource,
          readingTime,
          readBy: operatorId,
          notes: notes || null,
          dedupKey,
        },
      });

      let deduction: Record<string, unknown> = { applied: false, reason: '已采集读数，未开启自动扣费（等待周期结算）' };
      if (shouldAutoSettle) {
        // 按读数业务日期取生效单价（T274）；缺历史时回落到表上当前价
        const unitPrice = await this.priceService.resolveUnitPrice(meter, readingTime, tx);
        deduction = await this.billingService.applyReadingDeduction(
          tx,
          meter,
          reading,
          billableUsage,
          operatorId,
          unitPrice,
        );
        // 统一入账基准：仅当扣费或生成账单成功时，才正式盖印结算字段
        if (deduction.applied || billableUsage === 0) {
          const settledNotes = reading.notes ? `${reading.notes} [SETTLED]` : '[SETTLED]';
          const deducted = Number(deduction.deducted ?? 0);
          const shortfall = Number(deduction.shortfall ?? 0);
          await tx.meterReading.update({
            where: { id: reading.id },
            data: {
              notes: settledNotes,
              settledAt: new Date(),
              settledUsage: billableUsage,
              settledUnitPrice: unitPrice,
              settledAmount: deducted + shortfall,
            },
          });
          reading.notes = settledNotes;
        }
      }

      return { reading, deduction };
    });
    } catch (error) {
      // 并发重投：两个请求同时通过前置检查时由唯一约束兜底，返回先落库的那条
      if (isUniqueViolation(error, 'dedupKey')) {
        const existing = await this.prisma.meterReading.findFirst({ where: { meterId, dedupKey } });
        if (existing) {
          if ((existing.source === 'SIMULATED') !== (source === 'SIMULATED')) {
            throw new BadRequestException('历史模拟读数的去重键与真实读数冲突，需人工核对');
          }
          assertSimulationReplay(existing);
          return {
            reading: existing,
            deduction: { applied: false, reason: '重复读数（去重键已存在），已忽略并返回已有记录' },
          };
        }
      }
      throw error;
    }
  }

  /**
   * 讀數歷史（分頁，按讀數時間倒序）
   */
  async findReadings(meterId: string, query: QueryMeterReadingsDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.meterReading.findMany({
        where: { meterId },
        skip,
        take: limit,
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.meterReading.count({ where: { meterId } }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
