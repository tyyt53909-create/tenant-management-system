import { Test, TestingModule } from '@nestjs/testing';
import { BuildingsController } from './buildings.controller.js';
import { BuildingsService } from './buildings.service.js';

describe('BuildingsController', () => {
  let controller: BuildingsController;
  let service: BuildingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuildingsController],
      providers: [
        {
          provide: BuildingsService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BuildingsController>(BuildingsController);
    service = module.get<BuildingsService>(BuildingsService);
  });

  it('create：透传 DTO', async () => {
    const dto = { name: '默认楼栋', floors: 7 } as any;
    vi.spyOn(service, 'create').mockResolvedValue({ id: 'building-001' } as any);

    const result = await controller.create(dto);

    expect(result.id).toBe('building-001');
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll：透传查询条件（仅管理者，T148）', async () => {
    vi.spyOn(service, 'findAll').mockResolvedValue({ data: [], meta: {} } as any);

    await controller.findAll({ page: 1, limit: 20 } as any);

    expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('findOne：透传 id', async () => {
    vi.spyOn(service, 'findOne').mockResolvedValue({ id: 'building-001' } as any);

    const result = await controller.findOne('building-001');

    expect(result.id).toBe('building-001');
    expect(service.findOne).toHaveBeenCalledWith('building-001');
  });

  it('update：透传 id 与 DTO', async () => {
    const dto = { name: '新名字' } as any;
    vi.spyOn(service, 'update').mockResolvedValue({ id: 'building-001', name: '新名字' } as any);

    const result = await controller.update('building-001', dto);

    expect(result.name).toBe('新名字');
    expect(service.update).toHaveBeenCalledWith('building-001', dto);
  });

  it('remove：删除楼栋', async () => {
    vi.spyOn(service, 'remove').mockResolvedValue({ message: '楼栋已删除' });

    const result = await controller.remove('building-001');

    expect(result.message).toBe('楼栋已删除');
    expect(service.remove).toHaveBeenCalledWith('building-001');
  });
});
