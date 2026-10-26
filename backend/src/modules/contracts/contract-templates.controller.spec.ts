import { Test, TestingModule } from '@nestjs/testing';
import { ContractTemplatesController } from './contract-templates.controller.js';
import { ContractTemplatesService } from './contract-templates.service.js';

describe('ContractTemplatesController', () => {
  let controller: ContractTemplatesController;
  let service: any;

  beforeEach(async () => {
    service = {
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findDefault: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      findOne: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      create: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      update: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
      remove: vi.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractTemplatesController],
      providers: [{ provide: ContractTemplatesService, useValue: service }],
    }).compile();

    controller = module.get<ContractTemplatesController>(ContractTemplatesController);
  });

  it('delegates all methods to ContractTemplatesService', async () => {
    expect(await controller.findAll({})).toEqual({ data: [], meta: { total: 0 } });
    expect(await controller.findDefault()).toEqual({ id: 'tmpl-1' });
    expect(await controller.findOne('tmpl-1')).toEqual({ id: 'tmpl-1' });
    expect(await controller.create({ name: 'T' } as any, { userId: 'u1' } as any)).toEqual({ id: 'tmpl-1' });
    expect(await controller.update('tmpl-1', { name: 'T2' } as any)).toEqual({ id: 'tmpl-1' });
    expect(await controller.remove('tmpl-1')).toEqual({ success: true });
  });
});
