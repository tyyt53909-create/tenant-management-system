import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { MetersSimulatorService } from '../src/modules/meters/meters-simulator.service.js';
import { SimulationScenario } from '../src/modules/meters/dto/run-simulation.dto.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      options[key] = val !== undefined ? val : 'true';
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  const rawScenario = (options.scenario || 'DAILY_HOURLY').toUpperCase();

  let scenario: SimulationScenario;
  if (rawScenario === 'DAILY' || rawScenario === 'HOURLY' || rawScenario === 'DAILY_HOURLY') {
    scenario = SimulationScenario.DAILY_HOURLY;
  } else if (rawScenario === 'MONTH' || rawScenario === 'TIME_TRAVEL' || rawScenario === 'TIME_TRAVEL_MONTH') {
    scenario = SimulationScenario.TIME_TRAVEL_MONTH;
  } else if (rawScenario === 'ANOMALY' || rawScenario === 'TEST' || rawScenario === 'ANOMALY_TEST') {
    scenario = SimulationScenario.ANOMALY_TEST;
  } else {
    console.error(`❌ 未知模拟场景: ${rawScenario}`);
    console.log('可用场景: DAILY_HOURLY | TIME_TRAVEL_MONTH | ANOMALY_TEST');
    process.exit(1);
  }

  const days = options.days ? parseInt(options.days, 10) : 30;
  const meterId = options.meterId;
  const buildingId = options.buildingId;
  const autoSettle = options.autoSettle === 'true';

  console.log('====================================================');
  console.log('⚡ 虚拟水电表模拟器 (Virtual Meter Simulator CLI)');
  console.log('====================================================');
  console.log(`- 模拟场景: ${scenario}`);
  if (meterId) console.log(`- 指定表计: ${meterId}`);
  if (buildingId) console.log(`- 指定楼栋: ${buildingId}`);
  if (scenario === SimulationScenario.TIME_TRAVEL_MONTH) console.log(`- 模拟天数: ${days} 天`);
  console.log(`- 自动结算扣费: ${autoSettle ? '是' : '否（仅作为未结算用量留存）'}`);
  console.log('正在初始化应用上下文与数据库连接...');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const simulator = app.get(MetersSimulatorService);
    const result = await simulator.runSimulation(
      {
        scenario,
        meterId,
        buildingId,
        days,
        autoSettle,
      },
      'cli-simulator',
    );

    console.log('\n✅ 模拟运行成功！');
    console.log(`📢 结果说明: ${result.message}`);

    if (result.scenario === SimulationScenario.ANOMALY_TEST && result.anomalyResults) {
      console.log('\n--- 攻防与异常自检报告 ---');
      console.log(`目标表号: ${result.anomalyResults.meterNumber}`);
      console.log(`测试统计: 共 ${result.anomalyResults.totalTests} 项，通过: ${result.anomalyResults.passedCount}，失败: ${result.anomalyResults.failedCount}`);
      result.anomalyResults.testCases.forEach((tc, idx) => {
        const icon = tc.status === 'PASSED' ? '🟢' : '🔴';
        console.log(`${idx + 1}. [${tc.testCase}] ${icon} ${tc.name}`);
        console.log(`   详情: ${tc.detail}`);
      });
    } else if (result.meterResults && result.meterResults.length > 0) {
      console.log('\n--- 表计读数生成明细 ---');
      console.table(
        result.meterResults.map((m) => ({
          表号: m.meterNumber,
          房间: m.roomNumber,
          类型: m.meterType === 'ELECTRICITY' ? '电表' : '水表',
          点位数: m.pointsCount,
          起步读数: m.startReading,
          截止读数: m.endReading,
          仿真总用量: m.totalUsage,
        })),
      );
    }
  } catch (err: any) {
    console.error('\n❌ 模拟运行失败:', err.message || err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();
