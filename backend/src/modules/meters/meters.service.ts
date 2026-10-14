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

    return this.prisma.meter.create({
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
   * - 自動取上一條讀數作為 previousReading，計算 usage
   * - 房間關聯預付帳戶時自動扣費（用量 × 當前單價）
   * - 餘額不足：先扣盡餘額，差額生成 UTILITY 補繳帳單（dueDate = 讀數日 + 7 天）
   * - 公共區域表按運營成本處理，不扣費（docs/09-待确认清单.md §7）
   */
  async createReading(meterId: string, dto: CreateMeterReadingDto, operatorId: string) {
    const readingTime = dto.readingTime ? new Date(dto.readingTime) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const meter = await tx.meter.findUnique({ where: { id: meterId } });

      if (!meter) {
        throw new NotFoundException('水电表不存在');
      }

      if (!meter.isActive) {
        throw new BadRequestException('水电表已停用，不能登记读数');
      }

      const previous = await tx.meterReading.findFirst({
        where: { meterId },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      const previousReading = previous ? Number(previous.currentReading) : 0;

      if (dto.currentReading < previousReading) {
        throw new BadRequestException(
          `当前读数（${dto.currentReading}）不能小于上次读数（${previousReading}）`,
        );
      }

      const usage = Math.round((dto.currentReading - previousReading) * 100) / 100;

      const reading = await tx.meterReading.create({
        data: {
          meterId,
          currentReading: dto.currentReading,
          previousReading,
          usage,
          source: 'MANUAL',
          readingTime,
          readBy: operatorId,
          notes: dto.notes,
        },
      });

      const deduction = await this.applyReadingDeduction(tx, meter, reading, usage, operatorId);

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

        const previous = await tx.meterReading.findFirst({
          where: { meterId: item.meterId },
          orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
        });
        const previousReading = previous ? Number(previous.currentReading) : 0;

        if (item.currentReading < previousReading) {
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
        const readingTime = item.readingTime ? new Date(item.readingTime) : new Date();

        const reading = await tx.meterReading.create({
          data: {
            meterId: item.meterId,
            currentReading: item.currentReading,
            previousReading,
            usage,
            source: 'MANUAL',
            readingTime,
            readBy: operatorId,
            notes: item.notes,
          },
        });

        const deduction = await this.applyReadingDeduction(tx, meter, reading, usage, operatorId);

        results.push({
          meterId: item.meterId,
          meterNumber: meter.meterNumber,
          roomNumber: meter.room?.roomNumber,
          success: true,
          currentReading: item.currentReading,
          previousReading,
          usage,
          amount: deduction.amount,
          deducted: deduction.deducted,
          shortfall: deduction.shortfall,
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
    if (deducted > 0) {
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
            reason: '预付账户余额不足，补缴差额',
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
}
