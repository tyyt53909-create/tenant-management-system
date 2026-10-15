import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetersService } from './meters.service.js';
import { RunSimulationDto, SimulationScenario } from './dto/run-simulation.dto.js';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly metersService: MetersService,
  ) {}

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

      let currentVal = latest ? Number(latest.currentReading) : (meter.initialReading ? Number(meter.initialReading) : 100.0);
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
            source: 'DEVICE',
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
            source: 'DEVICE',
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

      let currentVal = latest ? Number(latest.currentReading) : (meter.initialReading ? Number(meter.initialReading) : 100.0);
      const startReading = currentVal;

      let startBaseTime: Date;
      if (!latest) {
        startBaseTime = new Date(Date.now() - days * 86400 * 1000);
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: currentVal,
            readingTime: startBaseTime.toISOString(),
            source: 'DEVICE',
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
            source: 'DEVICE',
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
    if (!targetMeters.length) {
      throw new NotFoundException('未找到可用表计以执行异常测试');
    }

    // 选取第一个目标表进行专项攻防检测
    const meter = targetMeters[0];
    const testCases: NonNullable<SimulationResult['anomalyResults']>['testCases'] = [];

    // 1. 基准准备
    const latest = await this.prisma.meterReading.findFirst({
      where: { meterId: meter.id },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });
    const baseVal = latest ? Number(latest.currentReading) : 100.0;
    const baseTimeMs = latest ? Math.max(Date.now(), latest.readingTime.getTime() + 60_000) : Date.now();

    // ---- Case 1: 消息唯一性幂等（同一 messageId 重复投递） ----
    try {
      const dupMsgId = `ANOMALY-MSG-ID-${Date.now()}`;
      const t1 = new Date(baseTimeMs + 60_000);
      const val1 = Math.round((baseVal + 1.0) * 100) / 100;

      // 首次发送
      await this.metersService.createReading(
        meter.id,
        {
          currentReading: val1,
          readingTime: t1.toISOString(),
          source: 'DEVICE',
          autoSettle: false,
          messageId: dupMsgId,
          notes: '[ANOMALY] 幂等测试首次上报',
        },
        operatorId,
      );

      // 再次发送完全相同 messageId 的数据（模拟设备重试或网络回放）
      const res2 = await this.metersService.createReading(
        meter.id,
        {
          currentReading: val1,
          readingTime: t1.toISOString(),
          source: 'DEVICE',
          autoSettle: false,
          messageId: dupMsgId,
          notes: '[ANOMALY] 幂等测试重复上报',
        },
        operatorId,
      );

      const isDeduplicated = res2.deduction?.applied === false && String(res2.deduction?.reason).includes('重复消息');
      testCases.push({
        testCase: 'DUPLICATE_MESSAGE_ID',
        name: '相同 messageId 重复上传幂等防御',
        status: isDeduplicated ? 'PASSED' : 'FAILED',
        detail: isDeduplicated
          ? `成功拦截重复投递（${dupMsgId}），系统平稳返回已有记录且未发生二次计费`
          : `未正确拦截重复 messageId: ${JSON.stringify(res2.deduction)}`,
      });
    } catch (err: any) {
      testCases.push({
        testCase: 'DUPLICATE_MESSAGE_ID',
        name: '相同 messageId 重复上传幂等防御',
        status: 'FAILED',
        detail: `测试抛出异常: ${err.message}`,
      });
    }

    // ---- Case 2: 同一时间戳与读数的设备重复上报防重 ----
    try {
      const dupTimeStr = new Date(baseTimeMs + 120_000).toISOString();
      const val2 = Math.round((baseVal + 2.0) * 100) / 100;

      await this.metersService.createReading(
        meter.id,
        {
          currentReading: val2,
          readingTime: dupTimeStr,
          source: 'DEVICE',
          autoSettle: false,
          notes: '[ANOMALY] 时间戳重复测试首次',
        },
        operatorId,
      );

      const resDup = await this.metersService.createReading(
        meter.id,
        {
          currentReading: val2,
          readingTime: dupTimeStr,
          source: 'DEVICE',
          autoSettle: false,
          notes: '[ANOMALY] 时间戳重复测试二次',
        },
        operatorId,
      );

      const isTimestampDedup = resDup.deduction?.applied === false && String(resDup.deduction?.reason).includes('重复上报');
      testCases.push({
        testCase: 'DUPLICATE_TIMESTAMP',
        name: '同一时间戳与读数设备重发防重',
        status: isTimestampDedup ? 'PASSED' : 'FAILED',
        detail: isTimestampDedup
          ? '成功识别相同时间戳与读数的重发包，平稳归一并免除重复处理'
          : `未正确防重: ${JSON.stringify(resDup.deduction)}`,
      });
    } catch (err: any) {
      testCases.push({
        testCase: 'DUPLICATE_TIMESTAMP',
        name: '同一时间戳与读数设备重发防重',
        status: 'FAILED',
        detail: `测试抛出异常: ${err.message}`,
      });
    }

    // ---- Case 3: 延迟乱序到达包入库与防误扣费 ----
    try {
      // 预先建立未来的最新记录
      const futureTime = new Date(baseTimeMs + 600_000);
      const futureVal = Math.round((baseVal + 10.0) * 100) / 100;
      await this.metersService.createReading(
        meter.id,
        {
          currentReading: futureVal,
          readingTime: futureTime.toISOString(),
          source: 'DEVICE',
          autoSettle: false,
          notes: '[ANOMALY] 前置未来正常读数',
        },
        operatorId,
      );

      // 插入一条介于两者之间的延迟乱序包
      const delayedTime = new Date(baseTimeMs + 300_000);
      const delayedVal = Math.round((baseVal + 5.0) * 100) / 100;
      const resDelayed = await this.metersService.createReading(
        meter.id,
        {
          currentReading: delayedVal,
          readingTime: delayedTime.toISOString(),
          source: 'DEVICE',
          autoSettle: false,
          notes: '[ANOMALY] 延迟到达包',
        },
        operatorId,
      );

      const hasOutOfOrderTag = String(resDelayed.reading?.notes).includes('[OUT_OF_ORDER]');
      const noImmediateDeduction = resDelayed.deduction?.applied === false;
      const pass = hasOutOfOrderTag && noImmediateDeduction;

      testCases.push({
        testCase: 'OUT_OF_ORDER',
        name: '延迟乱序到达包录入与防误扣费',
        status: pass ? 'PASSED' : 'FAILED',
        detail: pass
          ? '乱序数据成功补录入库，准确标记 [OUT_OF_ORDER]，未触发即时扣费与指针错乱'
          : `未按预期处理乱序: ${JSON.stringify(resDelayed)}`,
      });
    } catch (err: any) {
      testCases.push({
        testCase: 'OUT_OF_ORDER',
        name: '延迟乱序到达包录入与防误扣费',
        status: 'FAILED',
        detail: `测试抛出异常: ${err.message}`,
      });
    }

    // ---- Case 4: 读数矛盾倒走与 400 校验拦截 ----
    try {
      const rollbackTime = new Date(baseTimeMs + 900_000);
      const rollbackVal = Math.round((baseVal + 1.0) * 100) / 100; // 显著低于当前最新 10.0

      let wasBlocked = false;
      let blockedMessage = '';
      try {
        await this.metersService.createReading(
          meter.id,
          {
            currentReading: rollbackVal,
            readingTime: rollbackTime.toISOString(),
            source: 'DEVICE',
            allowRollover: false,
            notes: '[ANOMALY] 非法倒走读数',
          },
          operatorId,
        );
      } catch (err: any) {
        if (err instanceof BadRequestException || err.status === 400) {
          wasBlocked = true;
          blockedMessage = err.message;
        } else {
          throw err;
        }
      }

      testCases.push({
        testCase: 'CONTRADICTORY_ROLLBACK',
        name: '矛盾/倒走读数校验与400拦截',
        status: wasBlocked ? 'PASSED' : 'FAILED',
        detail: wasBlocked
          ? `成功拦截倒走异常数据并抛出 400 提示: "${blockedMessage}"，保护表计账目安全`
          : '未能拦截读数小于上次读数的倒走错误',
      });
    } catch (err: any) {
      testCases.push({
        testCase: 'CONTRADICTORY_ROLLBACK',
        name: '矛盾/倒走读数校验与400拦截',
        status: 'FAILED',
        detail: `测试抛出未预期异常: ${err.message}`,
      });
    }

    const passedCount = testCases.filter((t) => t.status === 'PASSED').length;
    const failedCount = testCases.length - passedCount;

    return {
      success: failedCount === 0,
      scenario: SimulationScenario.ANOMALY_TEST,
      message: `异常重放与防御自检完成：${passedCount}/${testCases.length} 项测试通过`,
      anomalyResults: {
        totalTests: testCases.length,
        passedCount,
        failedCount,
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        testCases,
      },
    };
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

    const where: any = { status: 'ACTIVE' };
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
