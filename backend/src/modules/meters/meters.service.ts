import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { QueryUsageOverviewDto } from './dto/query-usage-overview.dto.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToYuanString } from '../../common/utils/currency.util.js';

/** 表类型 → 费用名称（用于扣费流水描述） */
const METER_TYPE_LABEL: Record<string, string> = {
  ELECTRICITY: '电费',
  WATER: '水费',
  GAS: '燃气费',
};

@Injectable()
export class MetersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMeterDto) {
    // 验证楼栋存在
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException('楼栋不存在');

    // 验证表号唯一性
    const existing = await this.prisma.meter.findUnique({ where: { meterNumber: dto.meterNumber } });
    if (existing) throw new ConflictException('表号已存在');

    return this.prisma.$transaction(async (tx) => {
      const meter = await tx.meter.create({
        data: {
          buildingId: dto.buildingId,
          roomId: dto.roomId,
          publicAreaId: dto.publicAreaId,
          meterType: dto.meterType as any,
          meterNumber: dto.meterNumber,
          unitPrice: dto.unitPrice,
          priceEffectiveDate: new Date(dto.priceEffectiveDate),
        },
      });

      // 设备绑定登记初始底数（不计费，作为后续起步值）
      if (dto.initialReading !== undefined && dto.initialReading !== null) {
        await tx.meterReading.create({
          data: {
            meterId: meter.id,
            currentReading: dto.initialReading,
            previousReading: dto.initialReading,
            usage: 0,
            source: 'MANUAL',
            readingTime: new Date(dto.priceEffectiveDate || Date.now()),
            readBy: 'SYSTEM',
            notes: '[INITIAL] 设备绑定登记初始底数',
          },
        });
      }

      return meter;
    });
  }

  async findAll(query: QueryMetersDto) {
    const { page = 1, limit = 20, meterType, buildingId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (meterType) where.meterType = meterType;
    if (buildingId) where.buildingId = buildingId;
    if (roomId) where.roomId = roomId;

    const [data, total] = await Promise.all([
      this.prisma.meter.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          building: { select: { name: true } },
          readings: { orderBy: [{readingTime:'desc'}, {createdAt:'desc'}], take: 1,
            select: { currentReading:true,previousReading:true,usage:true,readingTime:true } },
        },
      }),
      this.prisma.meter.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const meter = await this.prisma.meter.findUnique({
      where: { id },
      include: { room: true, building: true, readings: { take: 10, orderBy: { readingTime: 'desc' } } },
    });
    if (!meter) throw new NotFoundException('水电表不存在');
    return meter;
  }

  async update(id: string, dto: UpdateMeterDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const updateData: any = {};
    if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
    if (dto.priceEffectiveDate) updateData.priceEffectiveDate = new Date(dto.priceEffectiveDate);
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    return this.prisma.meter.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');
    await this.prisma.meter.delete({ where: { id } });
    return { message: '水电表已删除' };
  }

  /**
   * 水電讀數登記（docs/02-数据模型.md §2.14）
   * - 首次读数自动作为初始底数登记（usage=0，不计费）
   * - 支持设备消息去重（messageId / 重复时间读数检测）与乱序延迟上传保护
   * - 支持采集与结算拆分（autoSettle）
   * - 房间关联预付账户时根据单价自动扣费；余额不足差额生成 UTILITY 补缴账单
   */
  async createReading(meterId: string, dto: CreateMeterReadingDto, operatorId: string) {
    const readingTime = dto.readingTime ? new Date(dto.readingTime) : new Date();
    const source = dto.source || 'MANUAL';
    // 采集与结算拆分：手工录入默认自动结算，智能设备上传默认仅采集（除非显式指定 autoSettle: true）
    const shouldAutoSettle = dto.autoSettle !== undefined ? dto.autoSettle : (source !== 'DEVICE');

    return this.prisma.$transaction(async (tx) => {
      const meter = await tx.meter.findUnique({ where: { id: meterId } });

      if (!meter) {
        throw new NotFoundException('水电表不存在');
      }

      if (!meter.isActive) {
        throw new BadRequestException('水电表已停用，不能登记读数');
      }

      // 1. 消息幂等去重：相同 messageId 重复上传
      if (dto.messageId) {
        const msgTag = `[msgId:${dto.messageId}]`;
        const existingMsgReading = await tx.meterReading.findFirst({
          where: {
            meterId,
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
        where: { meterId },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

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
            source: source as any,
            readingTime,
            readBy: operatorId,
            notes,
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
            source: source as any,
            readingTime,
            readBy: operatorId,
            notes,
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
        billableUsage = Math.max(0, Math.round((dto.currentReading - settleBaseline) * 100) / 100);
      }

      const reading = await tx.meterReading.create({
        data: {
          meterId,
          currentReading: dto.currentReading,
          previousReading,
          usage,
          source: source as any,
          readingTime,
          readBy: operatorId,
          notes: notes || null,
        },
      });

      let deduction: any = { applied: false, reason: '已采集读数，未开启自动扣费（等待周期结算）' };
      if (shouldAutoSettle) {
        deduction = await this.applyReadingDeduction(tx, meter, reading, billableUsage, operatorId);
        // 统一入账基准：仅当扣费或生成账单成功时，才正式盖印 [SETTLED]
        if (deduction.applied || billableUsage === 0) {
          const settledNotes = reading.notes ? `${reading.notes} [SETTLED]` : '[SETTLED]';
          await tx.meterReading.update({
            where: { id: reading.id },
            data: { notes: settledNotes },
          });
          reading.notes = settledNotes;
        }
      }

      return { reading, deduction };
    });
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

  /**
   * 批量抄表工作台底表查询（平铺展示各房源水电表、最新读数及预付余额）
   */
  async getBatchSheet(query: QueryBatchSheetDto) {
    const where: any = { isActive: true };
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
              source: source as any,
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
              source: source as any,
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
        const shouldAutoSettle = item.autoSettle !== undefined ? item.autoSettle : (source !== 'DEVICE');

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
            source: source as any,
            readingTime,
            readBy: operatorId,
            notes: notes || null,
          },
        });

        let deduction: any = { applied: false, amount: 0, deducted: 0, shortfall: 0 };
        if (shouldAutoSettle) {
          deduction = await this.applyReadingDeduction(tx, meter, reading, billableUsage, operatorId);
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

  /**
   * 抄表台账数据 CSV 导出
   */
  async exportReadings(query: any) {
    const where: any = {};
    if (query.meterId) where.meterId = query.meterId;
    if (query.meterType) where.meter = { meterType: query.meterType };
    if (query.buildingId) {
      where.meter = { ...where.meter, buildingId: query.buildingId };
    }
    if (query.startDate || query.endDate) {
      where.readingTime = {};
      if (query.startDate) where.readingTime.gte = new Date(query.startDate);
      if (query.endDate) where.readingTime.lte = new Date(query.endDate);
    }

    const readings = await this.prisma.meterReading.findMany({
      where,
      include: {
        meter: {
          include: {
            room: true,
            building: true,
          },
        },
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
    });

    const columns: CsvColumn[] = [
      { header: '记录ID', key: 'id' },
      { header: '表号', formatter: (r) => r.meter?.meterNumber || '' },
      { header: '表类型', formatter: (r) => METER_TYPE_LABEL[r.meter?.meterType] || r.meter?.meterType || '' },
      { header: '楼栋', formatter: (r) => r.meter?.building?.name || '' },
      { header: '房间号', formatter: (r) => r.meter?.room?.roomNumber || '公共区域' },
      { header: '上次读数', formatter: (r) => Number(r.previousReading).toFixed(2) },
      { header: '本次读数', formatter: (r) => Number(r.currentReading).toFixed(2) },
      { header: '用量', formatter: (r) => Number(r.usage).toFixed(2) },
      { header: '单价(元)', formatter: (r) => centsToYuanString(r.meter?.unitPrice) },
      { header: '抄表时间', formatter: (r) => r.readingTime ? new Date(r.readingTime).toLocaleString('zh-CN') : '' },
      { header: '抄表人', key: 'readBy' },
      { header: '备注', key: 'notes' },
    ];

    return generateCsv(columns, readings);
  }

  /**
   * 讀數扣費：用量 × 當前單價
   * - 有生效合同 + 預付帳戶：先扣盡可用餘額（條件更新防並發），差額 → UTILITY 補繳帳單
   * - 無合同 / 無帳戶 / 公共區域 / 用量為 0：不扣費（返回原因）
   */
  private async applyReadingDeduction(
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

  async getUsageOverview(query: QueryUsageOverviewDto) {
    const { buildingId } = query;
    const now = new Date();
    const targetMonth = query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [yearStr, monthStr] = targetMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const prevMonthDate = new Date(Date.UTC(year, month - 2, 1, 0, 0, 0));
    const prevYear = prevMonthDate.getUTCFullYear();
    const prevMonth = prevMonthDate.getUTCMonth() + 1;
    const prevMonthStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1, 0, 0, 0));
    const prevMonthEnd = monthStart;

    const meterWhere: Prisma.MeterWhereInput = { isActive: true };
    if (buildingId) {
      meterWhere.buildingId = buildingId;
    }

    const activeMeters = await this.prisma.meter.findMany({
      where: meterWhere,
      select: {
        id: true,
        meterType: true,
        unitPrice: true,
      },
    });

    const activeMeterIds = activeMeters.map((m) => m.id);
    const meterMap = new Map(activeMeters.map((m) => [m.id, m]));

    const currentReadings =
      activeMeterIds.length > 0
        ? await this.prisma.meterReading.findMany({
            where: {
              meterId: { in: activeMeterIds },
              readingTime: { gte: monthStart, lt: monthEnd },
            },
            select: {
              meterId: true,
              usage: true,
              readingTime: true,
            },
          })
        : [];

    const prevReadings =
      activeMeterIds.length > 0
        ? await this.prisma.meterReading.findMany({
            where: {
              meterId: { in: activeMeterIds },
              readingTime: { gte: prevMonthStart, lt: prevMonthEnd },
            },
            select: {
              meterId: true,
              usage: true,
            },
          })
        : [];

    let waterUsage = 0;
    let waterCount = 0;
    let waterCost = 0;

    let electricityUsage = 0;
    let electricityCount = 0;
    let electricityCost = 0;

    const readMeterIds = new Set<string>();

    for (const r of currentReadings) {
      const meter = meterMap.get(r.meterId);
      if (!meter) continue;
      const usageVal = Number(r.usage) || 0;
      readMeterIds.add(r.meterId);

      if (meter.meterType === 'WATER') {
        waterUsage += usageVal;
        waterCount += 1;
        waterCost += Math.round(usageVal * meter.unitPrice);
      } else if (meter.meterType === 'ELECTRICITY') {
        electricityUsage += usageVal;
        electricityCount += 1;
        electricityCost += Math.round(usageVal * meter.unitPrice);
      }
    }

    let prevWaterUsage = 0;
    let prevElectricityUsage = 0;
    for (const r of prevReadings) {
      const meter = meterMap.get(r.meterId);
      if (!meter) continue;
      const usageVal = Number(r.usage) || 0;
      if (meter.meterType === 'WATER') {
        prevWaterUsage += usageVal;
      } else if (meter.meterType === 'ELECTRICITY') {
        prevElectricityUsage += usageVal;
      }
    }

    const calcMom = (curr: number, prev: number) => {
      if (prev <= 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 1000) / 10;
    };

    const trendMonths: Array<{ year: number; month: number; key: string; label: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(year, month - 1 - i, 1, 0, 0, 0));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      trendMonths.push({
        year: y,
        month: m,
        key: `${y}-${String(m).padStart(2, '0')}`,
        label: `${m}月`,
      });
    }

    const trendStart = new Date(Date.UTC(trendMonths[0].year, trendMonths[0].month - 1, 1, 0, 0, 0));
    const trendEnd = new Date(Date.UTC(trendMonths[5].year, trendMonths[5].month, 1, 0, 0, 0));

    const trendReadings =
      activeMeterIds.length > 0
        ? await this.prisma.meterReading.findMany({
            where: {
              meterId: { in: activeMeterIds },
              readingTime: { gte: trendStart, lt: trendEnd },
            },
            select: {
              meterId: true,
              usage: true,
              readingTime: true,
            },
          })
        : [];

    const trendMap = new Map<string, { electricity: number; water: number; electricityCost: number; waterCost: number }>();
    for (const tm of trendMonths) {
      trendMap.set(tm.key, { electricity: 0, water: 0, electricityCost: 0, waterCost: 0 });
    }

    for (const tr of trendReadings) {
      const d = new Date(tr.readingTime);
      const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const entry = trendMap.get(k);
      const meter = meterMap.get(tr.meterId);
      if (entry && meter) {
        const u = Number(tr.usage) || 0;
        if (meter.meterType === 'ELECTRICITY') {
          entry.electricity = Math.round((entry.electricity + u) * 100) / 100;
          entry.electricityCost += Math.round(u * meter.unitPrice);
        } else if (meter.meterType === 'WATER') {
          entry.water = Math.round((entry.water + u) * 100) / 100;
          entry.waterCost += Math.round(u * meter.unitPrice);
        }
      }
    }

    const trend = trendMonths.map((tm) => {
      const data = trendMap.get(tm.key) || { electricity: 0, water: 0, electricityCost: 0, waterCost: 0 };
      return {
        month: tm.key,
        label: tm.label,
        electricityUsage: data.electricity,
        waterUsage: data.water,
        electricityCost: data.electricityCost,
        waterCost: data.waterCost,
      };
    });

    const totalActiveMeters = activeMeters.length;
    const completedMeters = readMeterIds.size;
    const pendingMeters = Math.max(0, totalActiveMeters - completedMeters);

    const hasData = currentReadings.length > 0 || prevReadings.length > 0;
    const isDemo = !hasData;

    const resultWaterUsage = isDemo ? 32.6 : Math.round(waterUsage * 10) / 10;
    const resultWaterMom = isDemo ? 7.9 : calcMom(waterUsage, prevWaterUsage);
    const resultWaterCount = isDemo ? 18 : waterCount;

    const resultElecUsage = isDemo ? 827 : Math.round(electricityUsage * 10) / 10;
    const resultElecMom = isDemo ? 7.7 : calcMom(electricityUsage, prevElectricityUsage);
    const resultElecCount = isDemo ? 22 : electricityCount;

    const resultWaterCost = isDemo ? 13692 : waterCost;
    const resultElecCost = isDemo ? 74430 : electricityCost;
    const resultTotalCost = resultWaterCost + resultElecCost;

    const resultCompletedMeters = isDemo ? 28 : completedMeters;
    const resultTotalMeters = isDemo ? 36 : totalActiveMeters;
    const resultPendingMeters = isDemo ? 8 : pendingMeters;

    const demoTrend = [
      { month: trendMonths[0].key, label: trendMonths[0].label, electricityUsage: 640, waterUsage: 26.2, electricityCost: 57600, waterCost: 10480 },
      { month: trendMonths[1].key, label: trendMonths[1].label, electricityUsage: 710, waterUsage: 28.5, electricityCost: 63900, waterCost: 11400 },
      { month: trendMonths[2].key, label: trendMonths[2].label, electricityUsage: 890, waterUsage: 35.1, electricityCost: 80100, waterCost: 14040 },
      { month: trendMonths[3].key, label: trendMonths[3].label, electricityUsage: 930, waterUsage: 38.0, electricityCost: 83700, waterCost: 15200 },
      { month: trendMonths[4].key, label: trendMonths[4].label, electricityUsage: 768, waterUsage: 30.2, electricityCost: 69120, waterCost: 12080 },
      { month: trendMonths[5].key, label: trendMonths[5].label, electricityUsage: 827, waterUsage: 32.6, electricityCost: 74430, waterCost: 13692 },
    ];

    return {
      month: targetMonth,
      isDemo,
      water: {
        usage: resultWaterUsage,
        momRate: resultWaterMom,
        count: resultWaterCount,
      },
      electricity: {
        usage: resultElecUsage,
        momRate: resultElecMom,
        count: resultElecCount,
      },
      cost: {
        total: resultTotalCost,
        waterCost: resultWaterCost,
        electricityCost: resultElecCost,
      },
      completion: {
        completedMeters: resultCompletedMeters,
        totalMeters: resultTotalMeters,
        pendingMeters: resultPendingMeters,
        status: resultPendingMeters > 0 ? 'FOLLOW_UP' : 'DONE',
      },
      trend: isDemo ? demoTrend : trend,
    };
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
        where: { meterId },
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
          where: { meterId },
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
  ) {
    let meterIds = dto.meterIds;
    if (!meterIds || meterIds.length === 0) {
      const where: any = { isActive: true };
      if (dto.buildingId) where.buildingId = dto.buildingId;
      const meters = await this.prisma.meter.findMany({ where, select: { id: true } });
      meterIds = meters.map((m) => m.id);
    }

    const results: any[] = [];
    for (const id of meterIds) {
      try {
        const res = await this.settleMeter(id, { settleUntil: dto.settleUntil, notes: dto.notes }, operatorId);
        results.push({ success: true, ...res });
      } catch (err: any) {
        results.push({ meterId: id, success: false, error: err.message });
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
