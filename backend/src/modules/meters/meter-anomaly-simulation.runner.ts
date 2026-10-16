import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MetersService } from './meters.service.js';
import { RunSimulationDto, SimulationScenario } from './dto/run-simulation.dto.js';
import type { SimulationResult } from './meters-simulator.service.js';

@Injectable()
export class MeterAnomalySimulationRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metersService: MetersService,
  ) {}

  /**
   * 场景 3：异常重放与防御自检测试套件
   */
  async runAnomalyTestSimulation(
    dto: RunSimulationDto,
    targetMeters: any[],
    operatorId: string,
  ): Promise<SimulationResult> {
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
        if (err instanceof BadRequestException || (err as any).status === 400) {
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
}
