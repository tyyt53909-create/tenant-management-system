import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetersService } from './meters.service.js';
import { RunSimulationDto, SimulationScenario } from './dto/run-simulation.dto.js';
import { MeterAnomalySimulationRunner } from './meter-anomaly-simulation.runner.js';

export interface SimulationResult {
  success: boolean;
  scenario: SimulationScenario;
  message: string;
  totalMeters?: number;
  totalReadings?: number;
  days?: number;
  meterResults?: Array<{
    meterId: string;
    meterNumber: string;
    meterType: string;
    roomNumber: string;
    pointsCount: number;
    totalUsage: number;
    startReading: number;
    endReading: number;
  }>;
  anomalyResults?: {
    totalTests: number;
    passedCount: number;
    failedCount: number;
    meterId: string;
    meterNumber: string;
    testCases: Array<{
      testCase: string;
      name: string;
      status: 'PASSED' | 'FAILED';
      detail: string;
    }>;
  };
}

@Injectable()
export class MetersSimulatorService {
  private readonly logger = new Logger(MetersSimulatorService.name);
  private readonly anomalyRunner: MeterAnomalySimulationRunner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metersService: MetersService,
    @Optional() anomalyRunner?: MeterAnomalySimulationRunner,
  ) {
    this.anomalyRunner = anomalyRunner ?? new MeterAnomalySimulationRunner(prisma, metersService);
  }

  /**
   * 运行虚拟水电表模拟
   */
  async runSimulation(dto: RunSimulationDto, operatorId: string = 'system-simulator'): Promise<SimulationResult> {
    switch (dto.scenario) {
      case SimulationScenario.DAILY_HOURLY:
        return this.runDailyHourlySimulation(dto, operatorId);
      case SimulationScenario.TIME_TRAVEL_MONTH:
        return this.runTimeTravelMonthSimulation(dto, operatorId);
      case SimulationScenario.ANOMALY_TEST:
        return this.runAnomalyTestSimulation(dto, operatorId);
      default:
        throw new BadRequestException(`不支持的模拟场景: ${String(dto.scenario)}`);
    }
  }

  /**
   * 场景 1：24小时真实波峰波谷日用量曲线模拟
   */
  private async runDailyHourlySimulation(
    dto: RunSimulationDto,
    operatorId: string,
  ): Promise<SimulationResult> {
    const targetMeters = await this.getTargetMeters(dto);
    if (!targetMeters.length) {
      throw new NotFoundException('未找到符合条件的有效表计');
    }

    const variance = dto.variance ?? 0.15;
    const meterResults: NonNullable<SimulationResult['meterResults']> = [];
    let grandTotalReadings = 0;

    for (const meter of targetMeters) {
      const latest = await this.prisma.meterReading.findFirst({
        where: { meterId: meter.id },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      const fallbackInitial = typeof (meter as { initialReading?: unknown }).initialReading === 'number'
        ? Number((meter as { initialReading?: number }).initialReading)
        : 100.0;
      let currentVal = latest ? Number(latest.currentReading) : fallbackInitial;
      const startReading = currentVal;

      // 若此前没有任何读数记录，先补登记一条初始底数
      let startBaseTime: Date;
      if (!latest) {
        startBaseTime = new Date(Date.now() - 24 * 3600 * 1000);
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: currentVal,
            readingTime: startBaseTime.toISOString(),
            source: 'SIMULATED',
            isInitial: true,
            notes: '[SIMULATOR] 模拟器注册初始底数',
          },
          operatorId,
        );
      } else {
        startBaseTime = new Date(latest.readingTime.getTime() + 3600 * 1000);
      }

      let pointsCount = 0;
      const isElec = meter.meterType === 'ELECTRICITY';

      for (let h = 0; h < 24; h++) {
        const pointTime = new Date(startBaseTime.getTime() + h * 3600 * 1000);
        let baseDelta = 0;

        if (isElec) {
          // 电表曲线 (kWh)
          if (h >= 0 && h <= 5) {
            baseDelta = 0.08 + Math.random() * 0.04; // 夜间基底
          } else if (h >= 6 && h <= 8) {
            baseDelta = 0.75 + Math.random() * 0.35; // 早高峰
          } else if (h >= 9 && h <= 17) {
            baseDelta = 0.20 + Math.random() * 0.12; // 日间上班
          } else if (h >= 18 && h <= 22) {
            baseDelta = 1.45 + Math.random() * 0.55; // 晚高峰
          } else {
            baseDelta = 0.35 + Math.random() * 0.15; // 深夜回落
          }
        } else {
          // 水表曲线 (m³)
          if (h >= 0 && h <= 5) {
            baseDelta = 0.002 + Math.random() * 0.001; // 夜间渗流/静止
          } else if (h >= 6 && h <= 8) {
            baseDelta = 0.08 + Math.random() * 0.04; // 洗漱早餐
          } else if (h >= 9 && h <= 17) {
            baseDelta = 0.015 + Math.random() * 0.01; // 日间离家
          } else if (h >= 18 && h <= 22) {
            baseDelta = 0.16 + Math.random() * 0.07; // 洗澡做饭晚高峰
          } else {
            baseDelta = 0.03 + Math.random() * 0.015; // 晚间少量
          }
        }

        // 叠加随机波动
        const jitter = 1 + (Math.random() * 2 - 1) * variance;
        const delta = Math.max(0.01, Math.round(baseDelta * jitter * 100) / 100);
        currentVal = Math.round((currentVal + delta) * 100) / 100;

        const msgId = `SIM-DH-${meter.meterNumber}-${Date.now().toString(36)}-H${h}`;
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: currentVal,
            readingTime: pointTime.toISOString(),
            source: 'SIMULATED',
            autoSettle: !!dto.autoSettle,
            messageId: msgId,
            notes: `[SIM_DAILY_HOURLY] 第${h + 1}小时仿真读数（${h}:00）`,
          },
          operatorId,
        );

        pointsCount++;
      }

      grandTotalReadings += pointsCount;
      const totalUsage = Math.round((currentVal - startReading) * 100) / 100;
      meterResults.push({
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        meterType: meter.meterType,
        roomNumber: meter.room?.roomNumber || '未知房间',
        pointsCount,
        totalUsage,
        startReading,
        endReading: currentVal,
      });
    }

    return {
      success: true,
      scenario: SimulationScenario.DAILY_HOURLY,
      message: `已成功生成 ${targetMeters.length} 只表计的 24 小时真实用量波峰波谷日曲线（共 ${grandTotalReadings} 条读数）`,
      totalMeters: targetMeters.length,
      totalReadings: grandTotalReadings,
      meterResults,
    };
  }

  /**
   * 场景 2：30天月度时间穿梭递增模拟
   */
  private async runTimeTravelMonthSimulation(
    dto: RunSimulationDto,
    operatorId: string,
  ): Promise<SimulationResult> {
    const targetMeters = await this.getTargetMeters(dto);
    if (!targetMeters.length) {
      throw new NotFoundException('未找到符合条件的有效表计');
    }

    const days = dto.days || 30;
    const variance = dto.variance ?? 0.15;
    const meterResults: NonNullable<SimulationResult['meterResults']> = [];
    let grandTotalReadings = 0;

    for (const meter of targetMeters) {
      const latest = await this.prisma.meterReading.findFirst({
        where: { meterId: meter.id },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      const fallbackInitial = typeof (meter as { initialReading?: unknown }).initialReading === 'number'
        ? Number((meter as { initialReading?: number }).initialReading)
        : 100.0;
      let currentVal = latest ? Number(latest.currentReading) : fallbackInitial;
      const startReading = currentVal;

      let startBaseTime: Date;
      if (!latest) {
        startBaseTime = new Date(Date.now() - days * 86400 * 1000);
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: currentVal,
            readingTime: startBaseTime.toISOString(),
            source: 'SIMULATED',
            isInitial: true,
            notes: '[SIMULATOR] 模拟器注册时间穿梭初始底数',
          },
          operatorId,
        );
      } else {
        startBaseTime = new Date(latest.readingTime.getTime() + 86400 * 1000);
      }

      let pointsCount = 0;
      const isElec = meter.meterType === 'ELECTRICITY';

      for (let d = 0; d < days; d++) {
        const pointTime = new Date(startBaseTime.getTime() + d * 86400 * 1000);
        const dayOfWeek = pointTime.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        let dailyBase = 0;
        if (isElec) {
          // 工作日 8~14 kWh，周末 12~19 kWh
          dailyBase = isWeekend ? (12.0 + Math.random() * 7.0) : (8.0 + Math.random() * 6.0);
        } else {
          // 工作日 0.35~0.65 m³，周末 0.65~1.10 m³
          dailyBase = isWeekend ? (0.65 + Math.random() * 0.45) : (0.35 + Math.random() * 0.30);
        }

        const jitter = 1 + (Math.random() * 2 - 1) * variance;
        const delta = Math.max(0.1, Math.round(dailyBase * jitter * 100) / 100);
        currentVal = Math.round((currentVal + delta) * 100) / 100;

        const msgId = `SIM-TT-${meter.meterNumber}-${Date.now().toString(36)}-D${d + 1}`;
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: currentVal,
            readingTime: pointTime.toISOString(),
            source: 'SIMULATED',
            autoSettle: !!dto.autoSettle,
            messageId: msgId,
            notes: `[SIM_TIME_TRAVEL] 第${d + 1}/${days}天仿真读数`,
          },
          operatorId,
        );

        pointsCount++;
      }

      grandTotalReadings += pointsCount;
      const totalUsage = Math.round((currentVal - startReading) * 100) / 100;
      meterResults.push({
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        meterType: meter.meterType,
        roomNumber: meter.room?.roomNumber || '未知房间',
        pointsCount,
        totalUsage,
        startReading,
        endReading: currentVal,
      });
    }

    return {
      success: true,
      scenario: SimulationScenario.TIME_TRAVEL_MONTH,
      days,
      message: `已完成 ${days} 天月度时间穿梭用量模拟（${targetMeters.length} 只表计，累计 ${grandTotalReadings} 条读数），已就绪待结算用量`,
      totalMeters: targetMeters.length,
      totalReadings: grandTotalReadings,
      meterResults,
    };
  }

  /**
   * 场景 3：异常重放与防御自检测试套件
   */
  private async runAnomalyTestSimulation(
    dto: RunSimulationDto,
    operatorId: string,
  ): Promise<SimulationResult> {
    const targetMeters = await this.getTargetMeters(dto);
    return this.anomalyRunner.runAnomalyTestSimulation(dto, targetMeters, operatorId);
  }

  /**
   * 过滤获取目标表计
   */
  private async getTargetMeters(dto: RunSimulationDto) {
    if (dto.meterId) {
      const meter = await this.prisma.meter.findUnique({
        where: { id: dto.meterId },
        include: { room: true },
      });
      return meter ? [meter] : [];
    }

    const where: Prisma.MeterWhereInput = { isActive: true };
    if (dto.buildingId) {
      where.room = { buildingId: dto.buildingId };
    }

    return this.prisma.meter.findMany({
      where,
      include: { room: true },
      take: 20, // 默认最多模拟前 20 只表，避免一次性生成超大载荷
      orderBy: { createdAt: 'asc' },
    });
  }
}
