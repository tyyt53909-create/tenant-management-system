import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { MetersService } from './meters.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SimulationScenario } from './dto/run-simulation.dto.js';

describe('MetersSimulatorService', () => {
  let simulatorService: MetersSimulatorService;
  let metersService: MetersService;
  let prisma: PrismaService;

  const mockMeter = {
    id: 'meter-001',
    meterNumber: 'ELEC-101',
    meterType: 'ELECTRICITY',
    initialReading: 50.0,
    room: { roomNumber: '101' },
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetersSimulatorService,
        {
          provide: PrismaService,
          useValue: {
            meter: {
              findUnique: vi.fn(),
              findMany: vi.fn(),
            },
            meterReading: {
              findFirst: vi.fn(),
            },
          },
        },
        {
          provide: MetersService,
          useValue: {
            createReading: vi.fn(),
          },
        },
      ],
    }).compile();

    simulatorService = module.get<MetersSimulatorService>(MetersSimulatorService);
    metersService = module.get<MetersService>(MetersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('runSimulation 场景路由与边界', () => {
    it('不支持的场景抛出 BadRequestException', async () => {
      await expect(
        simulatorService.runSimulation({ scenario: 'UNKNOWN_SCENARIO' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('未找到目标表计抛出 NotFoundException', async () => {
      vi.mocked(prisma.meter.findMany).mockResolvedValue([]);
      await expect(
        simulatorService.runSimulation({ scenario: SimulationScenario.DAILY_HOURLY }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('DAILY_HOURLY 24小时日曲线模拟', () => {
    it('为指定表生成 24 个按小时递增的仿真读数', async () => {
      vi.mocked(prisma.meter.findUnique).mockResolvedValue(mockMeter as any);
      vi.mocked(prisma.meterReading.findFirst).mockResolvedValue({
        id: 'r-latest',
        currentReading: 120.0,
        readingTime: new Date('2026-10-15T00:00:00Z'),
      } as any);

      vi.mocked(metersService.createReading).mockResolvedValue({
        reading: { id: 'r-sim' } as any,
        deduction: { applied: false },
      });

      const res = await simulatorService.runSimulation({
        scenario: SimulationScenario.DAILY_HOURLY,
        meterId: 'meter-001',
        variance: 0.1,
      });

      expect(res.success).toBe(true);
      expect(res.scenario).toBe(SimulationScenario.DAILY_HOURLY);
      expect(res.totalMeters).toBe(1);
      expect(res.totalReadings).toBe(24);
      expect(res.meterResults).toHaveLength(1);
      expect(res.meterResults![0].pointsCount).toBe(24);
      expect(res.meterResults![0].startReading).toBe(120.0);
      expect(res.meterResults![0].endReading).toBeGreaterThan(120.0);
      expect(metersService.createReading).toHaveBeenCalledTimes(24);
    });

    it('表计无历史记录时自动注册初始底数并生成 24 小时读数', async () => {
      vi.mocked(prisma.meter.findUnique).mockResolvedValue(mockMeter as any);
      vi.mocked(prisma.meterReading.findFirst).mockResolvedValue(null);

      vi.mocked(metersService.createReading).mockResolvedValue({
        reading: { id: 'r-sim' } as any,
        deduction: { applied: false },
      });

      const res = await simulatorService.runSimulation({
        scenario: SimulationScenario.DAILY_HOURLY,
        meterId: 'meter-001',
      });

      expect(res.success).toBe(true);
      // 1 条初始底数登记 + 24 条小时曲线读数 = 25 次调用
      expect(metersService.createReading).toHaveBeenCalledTimes(25);
      expect(metersService.createReading).toHaveBeenNthCalledWith(
        1,
        'meter-001',
        expect.objectContaining({ isInitial: true, currentReading: 50.0 }),
        'system-simulator',
      );
    });
  });

  describe('TIME_TRAVEL_MONTH 30天时间穿梭模拟', () => {
    it('按天生成递增读数，支持指定天数与周末用量加成', async () => {
      vi.mocked(prisma.meter.findMany).mockResolvedValue([mockMeter] as any);
      vi.mocked(prisma.meterReading.findFirst).mockResolvedValue({
        id: 'r-latest',
        currentReading: 200.0,
        readingTime: new Date('2026-09-01T00:00:00Z'),
      } as any);

      vi.mocked(metersService.createReading).mockResolvedValue({
        reading: { id: 'r-sim' } as any,
        deduction: { applied: false },
      });

      const res = await simulatorService.runSimulation({
        scenario: SimulationScenario.TIME_TRAVEL_MONTH,
        days: 7,
      });

      expect(res.success).toBe(true);
      expect(res.scenario).toBe(SimulationScenario.TIME_TRAVEL_MONTH);
      expect(res.days).toBe(7);
      expect(res.totalReadings).toBe(7);
      expect(metersService.createReading).toHaveBeenCalledTimes(7);
      expect(res.meterResults![0].endReading).toBeGreaterThan(200.0);
    });
  });

  describe('ANOMALY_TEST 异常与攻防自检套件', () => {
    it('执行四大防御测试用例并输出通过报告', async () => {
      vi.mocked(prisma.meter.findMany).mockResolvedValue([mockMeter] as any);
      vi.mocked(prisma.meterReading.findFirst).mockResolvedValue({
        id: 'r-latest',
        currentReading: 100.0,
        readingTime: new Date('2026-10-15T12:00:00Z'),
      } as any);

      // 模拟各种调用反应
      vi.mocked(metersService.createReading).mockImplementation(async (_meterId, dto) => {
        // Case 1 重复 messageId 反应
        if (dto.notes?.includes('幂等测试重复上报')) {
          return {
            reading: { id: 'r-dup-msg' } as any,
            deduction: { applied: false, reason: '重复消息（messageId 已存在），已忽略并返回已有记录' },
          };
        }
        // Case 2 重复时间戳反应
        if (dto.notes?.includes('时间戳重复测试二次')) {
          return {
            reading: { id: 'r-dup-time' } as any,
            deduction: { applied: false, reason: '同一时间戳与读数的设备重复上报，已忽略' },
          };
        }
        // Case 3 乱序到达
        if (dto.notes?.includes('延迟到达包')) {
          return {
            reading: { id: 'r-delayed', notes: '[OUT_OF_ORDER] 延迟乱序上报数据补录' } as any,
            deduction: { applied: false, reason: '延迟乱序数据已入库归档，不触发即时扣费' },
          };
        }
        // Case 4 矛盾倒走读数
        if (dto.notes?.includes('非法倒走读数')) {
          throw new BadRequestException('当前读数不能小于上次读数');
        }

        return {
          reading: { id: 'r-normal', currentReading: dto.currentReading } as any,
          deduction: { applied: false },
        };
      });

      const res = await simulatorService.runSimulation({
        scenario: SimulationScenario.ANOMALY_TEST,
      });

      expect(res.success).toBe(true);
      expect(res.scenario).toBe(SimulationScenario.ANOMALY_TEST);
      expect(res.anomalyResults).toBeDefined();
      expect(res.anomalyResults!.totalTests).toBe(4);
      expect(res.anomalyResults!.passedCount).toBe(4);
      expect(res.anomalyResults!.failedCount).toBe(0);

      const cases = res.anomalyResults!.testCases;
      expect(cases.find((c) => c.testCase === 'DUPLICATE_MESSAGE_ID')?.status).toBe('PASSED');
      expect(cases.find((c) => c.testCase === 'DUPLICATE_TIMESTAMP')?.status).toBe('PASSED');
      expect(cases.find((c) => c.testCase === 'OUT_OF_ORDER')?.status).toBe('PASSED');
      expect(cases.find((c) => c.testCase === 'CONTRADICTORY_ROLLBACK')?.status).toBe('PASSED');
    });
  });
});
