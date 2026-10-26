import { Test, TestingModule } from '@nestjs/testing';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { ContractRenewalsService } from './contract-renewals.service.js';

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: any;
  let renewalsService: any;

  beforeEach(async () => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'c1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'c1' }),
      findOneForTenant: vi.fn().mockResolvedValue({ id: 'c1' }),
      generatePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      renew: vi.fn().mockResolvedValue({ id: 'c2' }),
      update: vi.fn().mockResolvedValue({ id: 'c1' }),
      remove: vi.fn().mockResolvedValue({ message: 'ok' }),
      addCoTenant: vi.fn().mockResolvedValue({ id: 'cot-1' }),
      removeCoTenant: vi.fn().mockResolvedValue({ success: true }),
      initiateSignFlow: vi.fn().mockResolvedValue({ flowId: 'f1' }),
      getSignStatus: vi.fn().mockResolvedValue({ signStatus: 'SIGNED' }),
      mockCompleteSign: vi.fn().mockResolvedValue({ id: 'c1', signStatus: 'SIGNED' }),
      handleSignCallback: vi.fn().mockResolvedValue({ success: true }),
    };

    renewalsService = {
      findExpiringContracts: vi.fn().mockResolvedValue([]),
      findHoldoverContracts: vi.fn().mockResolvedValue([]),
      findAllRenewalIntents: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findAllRenewalOffers: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findMyRenewalOffers: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      respondRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro1', status: 'ACCEPTED' }),
      cancelRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro1', status: 'CANCELLED' }),
      submitRenewalIntent: vi.fn().mockResolvedValue({ id: 'ri1', intent: 'RENEW' }),
      getRenewalIntent: vi.fn().mockResolvedValue({ id: 'ri1' }),
      createRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        { provide: ContractsService, useValue: service },
        { provide: ContractRenewalsService, useValue: renewalsService },
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
  });

  it('create delegates to service', async () => {
    const dto = { buildingId: 'b1', roomId: 'r1', tenantId: 't1' } as any;
    expect(await controller.create(dto)).toEqual({ id: 'c1' });
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll delegates to service', async () => {
    expect(await controller.findAll({} as any)).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findAll).toHaveBeenCalled();
  });

  it('findMy for tenant and admin', async () => {
    expect(await controller.findMy({ role: 'TENANT', tenantId: 't1' } as any, {})).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findByTenant).toHaveBeenCalledWith('t1', {});

    expect(await controller.findMy({ role: 'ADMIN' } as any, {})).toEqual({ data: [], meta: { total: 0 } });
    expect(service.findAll).toHaveBeenCalled();
  });

  it('findOne for tenant and admin', async () => {
    expect(await controller.findOne({ role: 'TENANT', tenantId: 't1' } as any, 'c1')).toEqual({ id: 'c1' });
    expect(service.findOneForTenant).toHaveBeenCalledWith('c1', 't1');

    expect(await controller.findOne({ role: 'ADMIN' } as any, 'c1')).toEqual({ id: 'c1' });
    expect(service.findOne).toHaveBeenCalledWith('c1');
  });

  it('downloadPdf streams pdf buffer', async () => {
    const res = {
      setHeader: vi.fn(),
      send: vi.fn(),
    } as any;

    await controller.downloadPdf('c1', { role: 'ADMIN' } as any, res);
    expect(service.generatePdf).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.send).toHaveBeenCalled();
  });

  it('renew, update, remove delegate to service', async () => {
    expect(await controller.renew('c1', {} as any)).toEqual({ id: 'c2' });
    expect(await controller.update('c1', {} as any)).toEqual({ id: 'c1' });
    expect(await controller.remove('c1')).toEqual({ message: 'ok' });
  });

  it('co-tenants management delegates to service', async () => {
    expect(await controller.addCoTenant('c1', { name: '合租' } as any)).toEqual({ id: 'cot-1' });
    expect(await controller.removeCoTenant('c1', 'cot-1')).toEqual({ success: true });
  });

  it('sign flow endpoints delegate to service', async () => {
    expect(await controller.initiateSignFlow('c1', { userId: 'u1' } as any)).toEqual({ flowId: 'f1' });
    expect(await controller.getSignStatus('c1', { role: 'ADMIN' } as any)).toEqual({ signStatus: 'SIGNED' });
    expect(await controller.mockCompleteSign('c1')).toEqual({ id: 'c1', signStatus: 'SIGNED' });
    expect(await controller.handleSignCallback({ flowId: 'f1' })).toEqual({ success: true });
  });

  it('renewal endpoints delegate to renewalsService', async () => {
    expect(await controller.findExpiring('45')).toEqual([]);
    expect(renewalsService.findExpiringContracts).toHaveBeenCalledWith(45);

    expect(await controller.findHoldover()).toEqual([]);
    expect(renewalsService.findHoldoverContracts).toHaveBeenCalled();

    expect(await controller.findAllRenewalIntents({})).toEqual({ data: [], meta: { total: 0 } });
    expect(renewalsService.findAllRenewalIntents).toHaveBeenCalled();

    expect(await controller.findAllRenewalOffers({})).toEqual({ data: [], meta: { total: 0 } });
    expect(renewalsService.findAllRenewalOffers).toHaveBeenCalled();

    expect(await controller.findMyRenewalOffers({ role: 'TENANT', tenantId: 't1' } as any, {})).toEqual({ data: [], meta: { total: 0 } });
    expect(renewalsService.findMyRenewalOffers).toHaveBeenCalledWith('t1', {});

    expect(await controller.respondRenewalOffer('ro1', { agree: true } as any, { role: 'TENANT', tenantId: 't1' } as any)).toEqual({ id: 'ro1', status: 'ACCEPTED' });
    expect(renewalsService.respondRenewalOffer).toHaveBeenCalledWith('ro1', 't1', { agree: true });

    expect(await controller.cancelRenewalOffer('ro1')).toEqual({ id: 'ro1', status: 'CANCELLED' });
    expect(renewalsService.cancelRenewalOffer).toHaveBeenCalledWith('ro1');

    expect(await controller.submitRenewalIntent('c1', { intent: 'RENEW' } as any, { role: 'TENANT', tenantId: 't1' } as any)).toEqual({ id: 'ri1', intent: 'RENEW' });
    expect(renewalsService.submitRenewalIntent).toHaveBeenCalledWith('c1', 't1', { intent: 'RENEW' });

    expect(await controller.getRenewalIntent('c1', { role: 'TENANT', tenantId: 't1' } as any)).toEqual({ id: 'ri1' });
    expect(renewalsService.getRenewalIntent).toHaveBeenCalledWith('c1', 't1', true);

    expect(await controller.createRenewalOffer('c1', { offeredRent: 300000 } as any, { role: 'ADMIN', userId: 'admin1' } as any)).toEqual({ id: 'ro1' });
    expect(renewalsService.createRenewalOffer).toHaveBeenCalledWith('c1', 'admin1', { offeredRent: 300000 });
  });
});
