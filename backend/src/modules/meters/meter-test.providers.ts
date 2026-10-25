import { ConfigService } from '@nestjs/config';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeterPriceService } from './meter-price.service.js';

/**
 * 水电模块单测的 DI 装配助手（QLT-02 / T288）。
 *
 * 依赖从 `@Optional()` 改为必填后，每个 spec 都需要真实的时钟与计价服务；
 * 统一在这里构造，避免各 spec 各写一份 `new BusinessClock(new ConfigService())`
 * （那正是本任务要消灭的模式）。
 */
export function testClock(): BusinessClock {
  return new BusinessClock(new ConfigService({ NODE_ENV: 'test' }));
}

/** 计价服务用同一个 prisma mock，取价逻辑走真实实现。 */
export function testPriceService(prisma: unknown): MeterPriceService {
  return new MeterPriceService(prisma as PrismaService, testClock());
}

/** 便捷：返回可直接展开进 providers 的三元组。 */
export function meterTestProviders(prisma: unknown) {
  return [
    { provide: BusinessClock, useValue: testClock() },
    { provide: MeterPriceService, useValue: testPriceService(prisma) },
  ];
}
