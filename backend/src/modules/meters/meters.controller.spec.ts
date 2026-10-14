import { Test, TestingModule } from '@nestjs/testing';
import { MetersController } from './meters.controller.js';
import { MetersService } from './meters.service.js';

describe('MetersController', () => {
  let controller: MetersController;
  let service: MetersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetersController],
      providers: [
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
          },
        },
      ],
    }).compile();

    controller = module.get<MetersController>(MetersController);
    service = module.get<MetersService>(MetersService);
  });

  it('create：透传 DTO', async () => {
    const dto = { roomId: 'room-1', type: 'ELECTRICITY' } as any;
    vi.spyOn(service, 'create').mockResolvedValue({ id: 'meter-1' } as any);

    const result = await controller.create(dto);

    expect(result.id).toBe('meter-1');
    expect(service.create).toHaveBeenCalledWith(dto);
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

  it('update：透传 id 与 DTO', async () => {
    const dto = { meterNumber: 'M-002' } as any;
    vi.spyOn(service, 'update').mockResolvedValue({ id: 'meter-1' } as any);

    await controller.update('meter-1', dto);

    expect(service.update).toHaveBeenCalledWith('meter-1', dto);
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

    const result = await controller.exportReadings({}, resMock);

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
      isDemo: true,
      water: { usage: 32.6, momRate: 7.9, count: 18 },
      electricity: { usage: 827, momRate: 7.7, count: 22 },
      cost: { total: 88122, waterCost: 13692, electricityCost: 74430 },
      completion: { completedMeters: 28, totalMeters: 36, pendingMeters: 8, status: 'FOLLOW_UP' },
      trend: [],
    };
    vi.spyOn(service, 'getUsageOverview').mockResolvedValue(mockOverview as any);
    const query = { buildingId: 'b-1', month: '2026-10' };

    const result = await controller.getUsageOverview(query as any);

    expect(result).toEqual(mockOverview);
    expect(service.getUsageOverview).toHaveBeenCalledWith(query);
  });
});
