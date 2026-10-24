import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, MeterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { QueryUsageOverviewDto } from './dto/query-usage-overview.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToYuanString } from '../../common/utils/currency.util.js';
import { METER_TYPE_LABEL, NOT_SIMULATED } from './meter-types.constants.js';

export interface ExportMeterReadingsQuery {
  meterId?: string;
  meterType?: MeterType;
  buildingId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class MeterUsageQueryService {
  private readonly clock: BusinessClock;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() clock?: BusinessClock,
  ) {
    this.clock = clock ?? new BusinessClock(new ConfigService());
  }

  async exportReadings(query: ExportMeterReadingsQuery) {
    const where: Prisma.MeterReadingWhereInput = {};
    if (query.meterId) where.meterId = query.meterId;
    const meterWhere: Prisma.MeterWhereInput = {};
    if (query.meterType) meterWhere.meterType = query.meterType;
    if (query.buildingId) meterWhere.buildingId = query.buildingId;
    if (Object.keys(meterWhere).length > 0) {
      where.meter = meterWhere;
    }
    if (query.startDate || query.endDate) {
      where.readingTime = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
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

    type ReadingItem = (typeof readings)[number];
    const columns: CsvColumn<ReadingItem>[] = [
      { header: '记录ID', key: 'id' },
      { header: '表号', formatter: (r) => r.meter?.meterNumber || '' },
      { header: '表类型', formatter: (r) => (r.meter?.meterType ? METER_TYPE_LABEL[r.meter.meterType] || r.meter.meterType : '') },
      { header: '楼栋', formatter: (r) => r.meter?.building?.name || '' },
      { header: '房间号', formatter: (r) => r.meter?.room?.roomNumber || '公共区域' },
      { header: '上次读数', formatter: (r) => Number(r.previousReading).toFixed(2) },
      { header: '本次读数', formatter: (r) => Number(r.currentReading).toFixed(2) },
      { header: '用量', formatter: (r) => Number(r.usage).toFixed(2) },
      { header: '单价(元)', formatter: (r) => centsToYuanString(r.meter?.unitPrice ?? 0) },
      { header: '抄表时间', formatter: (r) => (r.readingTime ? new Date(r.readingTime).toLocaleString('zh-CN') : '') },
      { header: '抄表人', key: 'readBy' },
      { header: '备注', key: 'notes' },
    ];

    return generateCsv(columns, readings);
  }

  async getUsageOverview(query: QueryUsageOverviewDto) {
    const { buildingId } = query;
    const targetMonth = query.month || this.clock.monthKey();

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
              source: NOT_SIMULATED,
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
              source: NOT_SIMULATED,
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
              source: NOT_SIMULATED,
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
