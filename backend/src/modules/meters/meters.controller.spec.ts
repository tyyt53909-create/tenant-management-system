import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MetersController } from './meters.controller.js';
import { MetersService } from './meters.service.js';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { MeterReconciliationService } from './meter-reconciliation.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

describe('MetersController', () => {
  let controller: MetersController;
  let service: MetersService;
  let simulatorService: MetersSimulatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetersController],
      providers: [
        { provide: BusinessClock, useValue: { formatDate: () => '2026-10-24' } },
        {
          provide: MetersService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            createReading: vi.fn(),
            findReadings: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            getBatchSheet: vi.fn(),
            createBatchReadings: vi.fn(),
            exportReadings: vi.fn(),
            getUsageOverview: vi.fn(),
            settleMeter: vi.fn(),
            getUnsettledUsage: vi.fn(),
            settleBatch: vi.fn(),
            setPrice: vi.fn(),
            priceHistory: vi.fn(),
          },
        },
        {
          provide: MetersSimulatorService,
          useValue: {
            runSimulation: vi.fn(),
          },
        },
        {
          provide: MeterReconciliationService,
          useValue: { reconcile: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get<MetersController>(MetersController);
    service = module.get<MetersService>(MetersService);
    simulatorService = module.get<MetersSimulatorService>(MetersSimulatorService);
  });

  it('create：透传 DTO 与操作人', async () => {
    const dto = { roomId: 'room-1', type: 'ELECTRICITY' } as any;
    vi.spyOn(service, 'create').mockResolvedValue({ id: 'meter-1' } as any);

    const result = await controller.create({ user: { userId: 'admin-1' } }, dto);

    expect(result.id).toBe('meter-1');
    expect(service.create).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('findAll：透传查询条件（仅管理者，T148）', async () => {
    vi.spyOn(service, 'findAll').mockResolvedValue({ data: [], meta: {} } as any);

    await controller.findAll({ page: 1, limit: 20 } as any);

    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('createReading：透传表 id、DTO 与操作人', async () => {
    const dto = { reading: 1234 } as any;
    vi.spyOn(service, 'createReading').mockResolvedValue({ id: 'reading-1' } as any);

    await controller.createReading({ user: { userId: 'admin-1' } }, 'meter-1', dto);

    expect(service.createReading).toHaveBeenCalledWith('meter-1', dto, 'admin-1');
  });

  it('findReadings：透传表 id 与分页', async () => {
    vi.spyOn(service, 'findReadings').mockResolvedValue({ data: [], meta: {} } as any);

    await controller.findReadings('meter-1', { page: 1, limit: 20 } as any);

    expect(service.findReadings).toHaveBeenCalledWith('meter-1', { page: 1, limit: 20 });
  });

  it('findOne：透传 id', async () => {
    vi.spyOn(service, 'findOne').mockResolvedValue({ id: 'meter-1' } as any);

    const result = await controller.findOne('meter-1');

    expect(result.id).toBe('meter-1');
    expect(service.findOne).toHaveBeenCalledWith('meter-1');
  });

  it('update：透传 id、DTO 与操作人', async () => {
    const dto = { meterNumber: 'M-002' } as any;
    vi.spyOn(service, 'update').mockResolvedValue({ id: 'meter-1' } as any);

    await controller.update({ user: { userId: 'admin-1' } }, 'meter-1', dto);

    expect(service.update).toHaveBeenCalledWith('meter-1', dto, 'admin-1');
  });

  it('setPrice：透传表 id、调价 DTO 与操作人', async () => {
    const dto = { unitPrice: 120, effectiveDate: '2026-11-01' };
    vi.spyOn(service, 'setPrice').mockResolvedValue({ meter: { id: 'meter-1' } } as any);

    await controller.setPrice({ user: { userId: 'admin-1' } }, 'meter-1', dto as any);

    expect(service.setPrice).toHaveBeenCalledWith('meter-1', dto, 'admin-1');
  });

  it('priceHistory：透传表 id', async () => {
    vi.spyOn(service, 'priceHistory').mockResolvedValue({ items: [] } as any);

    await controller.priceHistory('meter-1');

    expect(service.priceHistory).toHaveBeenCalledWith('meter-1');
  });

  it('remove：删除水电表', async () => {
    vi.spyOn(service, 'remove').mockResolvedValue({ message: '水电表已删除' });

    const result = await controller.remove('meter-1');

    expect(result.message).toBe('水电表已删除');
    expect(service.remove).toHaveBeenCalledWith('meter-1');
  });

  it('getBatchSheet：透传查询条件', async () => {
    vi.spyOn(service, 'getBatchSheet').mockResolvedValue([{ meterId: 'm-1' }] as any);
    const query = { buildingId: 'b-1' };

    const result = await controller.getBatchSheet(query as any);

    expect(result).toHaveLength(1);
    expect(service.getBatchSheet).toHaveBeenCalledWith(query);
  });

  it('createBatchReadings：透传 DTO 与操作人', async () => {
    const dto = { readings: [{ meterId: 'm-1', currentReading: 120 }] };
    vi.spyOn(service, 'createBatchReadings').mockResolvedValue({ total: 1, successCount: 1, failureCount: 0, results: [] } as any);

    const result = await controller.createBatchReadings({ user: { userId: 'admin-1' } }, dto as any);

    expect(result.successCount).toBe(1);
    expect(service.createBatchReadings).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('exportReadings：设置下载响应头并返回 CSV 文本', async () => {
    vi.spyOn(service, 'exportReadings').mockResolvedValue('\uFEFF记录ID,表号\r\n1,M001');
    const resMock = { setHeader: vi.fn() };

    const result = await controller.exportReadings({}, resMock as any);

    expect(result).toContain('记录ID,表号');
    expect(resMock.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(resMock.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="meter-readings-'),
    );
  });

  it('getUsageOverview：透传查询参数并返回能耗概览', async () => {
    const mockOverview = {
      month: '2026-10',
      hasData: true,
      water: { usage: 12.5, momRate: 3.2, count: 4 },
      electricity: { usage: 320, momRate: -2.1, count: 6 },
      cost: { total: 42000, waterCost: 6000, electricityCost: 36000 },
      completion: { completedMeters: 10, totalMeters: 12, pendingMeters: 2, status: 'FOLLOW_UP' },
      trend: [],
    };
    vi.spyOn(service, 'getUsageOverview').mockResolvedValue(mockOverview as any);
    const query = { buildingId: 'b-1', month: '2026-10' };

    const result = await controller.getUsageOverview(query as any);

    expect(result).toEqual(mockOverview);
    expect(service.getUsageOverview).toHaveBeenCalledWith(query);
  });

  it('settleMeter：透传表 id、DTO 与操作人', async () => {
    const dto = { notes: '月度结算' };
    vi.spyOn(service, 'settleMeter').mockResolvedValue({ settled: true, usage: 100 } as any);

    const result = await controller.settleMeter({ user: { userId: 'admin-1' } }, 'meter-1', dto);

    expect(result.settled).toBe(true);
    expect(service.settleMeter).toHaveBeenCalledWith('meter-1', dto, 'admin-1');
  });

  it('getUnsettledUsage：透传表 id 与截止时间', async () => {
    vi.spyOn(service, 'getUnsettledUsage').mockResolvedValue({ unsettledUsage: 50, estimatedAmount: 5000 } as any);

    const result = await controller.getUnsettledUsage('meter-1', '2026-10-15T00:00:00Z');

    expect(result.unsettledUsage).toBe(50);
    expect(service.getUnsettledUsage).toHaveBeenCalledWith('meter-1', '2026-10-15T00:00:00Z');
  });

  it('settleBatch：透传批量结算 DTO 与操作人', async () => {
    const dto = { buildingId: 'b-1' };
    vi.spyOn(service, 'settleBatch').mockResolvedValue({ total: 5, successCount: 5, failureCount: 0, results: [] } as any);

    const result = await controller.settleBatch({ user: { userId: 'admin-1' } }, dto);

    expect(result.successCount).toBe(5);
    expect(service.settleBatch).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('runSimulation：开关关闭时返回 404，不执行模拟', async () => {
    const previous = process.env.FEATURE_METER_SIMULATOR;
    delete process.env.FEATURE_METER_SIMULATOR;
    const run = vi.spyOn(simulatorService, 'runSimulation');

    expect(() =>
      controller.runSimulation({ user: { userId: 'admin-1' } }, { scenario: 'DAILY_HOURLY' } as any),
    ).toThrow(NotFoundException);
    expect(run).not.toHaveBeenCalled();

    if (previous === undefined) delete process.env.FEATURE_METER_SIMULATOR;
    else process.env.FEATURE_METER_SIMULATOR = previous;
  });

  it('runSimulation：开关打开时透传模拟器 DTO 与操作人', async () => {
    const previous = process.env.FEATURE_METER_SIMULATOR;
    process.env.FEATURE_METER_SIMULATOR = 'true';
    const dto = { scenario: 'DAILY_HOURLY' } as any;
    vi.spyOn(simulatorService, 'runSimulation').mockResolvedValue({ success: true, scenario: 'DAILY_HOURLY', message: 'ok' } as any);

    const result = await controller.runSimulation({ user: { userId: 'admin-1' } }, dto);

    expect(result.success).toBe(true);
    expect(simulatorService.runSimulation).toHaveBeenCalledWith(dto, 'admin-1');

    if (previous === undefined) delete process.env.FEATURE_METER_SIMULATOR;
    else process.env.FEATURE_METER_SIMULATOR = previous;
  });
});
