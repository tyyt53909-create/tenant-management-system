import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: {
            getStats: vi.fn(),
            getRevenueTrend: vi.fn(),
            getRoomStatus: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStats', () => {
    it('应该返回统计数据', async () => {
      const mockStats = {
        totalRooms: 10,
        totalTenants: 8,
        activeContracts: 5,
        pendingBills: 3,
        vacantRooms: 4,
        occupiedRooms: 6,
        maintenanceRequests: 2,
      };
      vi.spyOn(service, 'getStats').mockResolvedValue(mockStats);

      const result = await controller.getStats();

      expect(result).toEqual(mockStats);
      expect(service.getStats).toHaveBeenCalled();
    });
  });

  describe('getRevenueTrend', () => {
    it('未传 months 时应默认 6 个月', async () => {
      vi.spyOn(service, 'getRevenueTrend').mockResolvedValue([]);

      await controller.getRevenueTrend(undefined);

      expect(service.getRevenueTrend).toHaveBeenCalledWith(6);
    });

    it('months 传数字字符串时应解析为数字', async () => {
      vi.spyOn(service, 'getRevenueTrend').mockResolvedValue([]);

      await controller.getRevenueTrend('12');

      expect(service.getRevenueTrend).toHaveBeenCalledWith(12);
    });

    it('months 传非法值时应传 NaN，由服务层回退默认值', async () => {
      vi.spyOn(service, 'getRevenueTrend').mockResolvedValue([]);

      await controller.getRevenueTrend('abc');

      expect(service.getRevenueTrend).toHaveBeenCalledWith(NaN);
    });
  });

  describe('getRoomStatus', () => {
    it('应该返回房源状态分布', async () => {
      const mockStatus = [
        { status: 'VACANT', count: 4 },
        { status: 'RESERVED', count: 0 },
        { status: 'OCCUPIED', count: 6 },
        { status: 'MAINTENANCE', count: 0 },
      ];
      vi.spyOn(service, 'getRoomStatus').mockResolvedValue(mockStatus);

      const result = await controller.getRoomStatus();

      expect(result).toEqual(mockStatus);
      expect(service.getRoomStatus).toHaveBeenCalled();
    });
  });
});
