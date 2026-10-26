import { Test, TestingModule } from '@nestjs/testing';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsService } from './inspections.service.js';

describe('InspectionsController', () => {
  let controller: InspectionsController;
  let service: any;

  beforeEach(async () => {
    service = {
      getTemplateItems: vi.fn().mockResolvedValue([{ name: '钥匙' }]),
      create: vi.fn().mockResolvedValue({ id: 'insp-1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'insp-1' }),
      findOneForTenant: vi.fn().mockResolvedValue({ id: 'insp-1' }),
      update: vi.fn().mockResolvedValue({ id: 'insp-1' }),
      confirm: vi.fn().mockResolvedValue({ id: 'insp-1', status: 'CONFIRMED' }),
      remove: vi.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InspectionsController],
      providers: [{ provide: InspectionsService, useValue: service }],
    }).compile();

    controller = module.get<InspectionsController>(InspectionsController);
  });

  it('delegates getTemplateItems & create', async () => {
    expect(await controller.getTemplateItems()).toEqual([{ name: '钥匙' }]);
    expect(
      await controller.create({ type: 'CHECK_IN' } as any, { userId: 'admin-1' } as any),
    ).toEqual({ id: 'insp-1' });
    expect(service.create).toHaveBeenCalledWith({ type: 'CHECK_IN' }, 'admin-1');
  });

  it('delegates findAll and findMy for tenant vs admin', async () => {
    expect(await controller.findAll({})).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findAll).toHaveBeenCalled();

    expect(
      await controller.findMy({ role: 'TENANT', tenantId: 't1' } as any, {}),
    ).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findByTenant).toHaveBeenCalledWith('t1', {});

    expect(
      await controller.findMy({ role: 'ADMIN' } as any, {}),
    ).toEqual({ data: [], meta: { total: 0 } });
  });

  it('delegates findOne, update, confirm, remove', async () => {
    expect(await controller.findOne({ role: 'ADMIN' } as any, 'insp-1')).toEqual({ id: 'insp-1' });
    expect(service.findOne).toHaveBeenCalledWith('insp-1');

    expect(
      await controller.findOne({ role: 'TENANT', tenantId: 't1' } as any, 'insp-1'),
    ).toEqual({ id: 'insp-1' });
    expect(service.findOneForTenant).toHaveBeenCalledWith('insp-1', 't1');

    expect(await controller.update('insp-1', {} as any)).toEqual({ id: 'insp-1' });
    expect(
      await controller.confirm(
        'insp-1',
        { agree: true },
        { role: 'TENANT', tenantId: 't1' } as any,
      ),
    ).toEqual({ id: 'insp-1', status: 'CONFIRMED' });
    expect(await controller.remove('insp-1')).toEqual({ success: true });
  });
});
