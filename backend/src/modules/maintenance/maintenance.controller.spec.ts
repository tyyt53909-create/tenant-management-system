import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

describe('MaintenanceController', () => {
  let controller: MaintenanceController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'mr-1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      getAssignedWorkOrders: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      getSlaAlerts: vi.fn().mockResolvedValue({ alerts: [], total: 0 }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOneForTenant: vi.fn().mockResolvedValue({ id: 'mr-1' }),
      findOne: vi.fn().mockResolvedValue({ id: 'mr-1' }),
      findMessages: vi.fn().mockResolvedValue({ data: [] }),
      addMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      dispatch: vi.fn().mockResolvedValue({ id: 'mr-1', status: 'ASSIGNED' }),
      startWork: vi.fn().mockResolvedValue({ id: 'mr-1', status: 'IN_PROGRESS' }),
      completeWork: vi.fn().mockResolvedValue({ id: 'mr-1', status: 'PENDING_CONFIRM' }),
      confirmWork: vi.fn().mockResolvedValue({ id: 'mr-1', status: 'COMPLETED' }),
      transferExpense: vi.fn().mockResolvedValue({ maintenanceRequest: { id: 'mr-1' }, bill: { id: 'bill-1' } }),
      update: vi.fn().mockResolvedValue({ id: 'mr-1' }),
      remove: vi.fn().mockResolvedValue({ message: 'ok' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaintenanceController],
      providers: [{ provide: MaintenanceService, useValue: service }],
    }).compile();

    controller = module.get<MaintenanceController>(MaintenanceController);
  });

  it('delegates create to service', async () => {
    const dto = { title: '漏水', description: '滴水', category: 'PLUMBING' as any };
    const current = { userId: 'u-1', role: 'ADMIN' };
    const res = await controller.create(current as any, dto);
    expect(res).toEqual({ id: 'mr-1' });
    expect(service.create).toHaveBeenCalledWith(dto, expect.objectContaining({ userId: 'u-1' }));
  });

  it('delegates findAll and getAssigned to service', async () => {
    const current = { userId: 'm-1', role: 'MAINTAINER' };
    await controller.findAll(current as any, {});
    expect(service.findAll).toHaveBeenCalledWith({}, expect.objectContaining({ userId: 'm-1' }));

    await controller.getAssigned(current as any, {});
    expect(service.getAssignedWorkOrders).toHaveBeenCalledWith('m-1', {});
  });

  it('delegates getSlaAlerts to service', async () => {
    const current = { userId: 'admin-1', role: 'ADMIN' };
    await controller.getSlaAlerts(current as any, {});
    expect(service.getSlaAlerts).toHaveBeenCalledWith({}, expect.objectContaining({ userId: 'admin-1' }));
  });

  it('delegates dispatch to service', async () => {
    const current = { userId: 'admin-1', role: 'ADMIN' };
    const dto = { assignedMaintainerId: 'm-1' };
    await controller.dispatch('mr-1', current as any, dto);
    expect(service.dispatch).toHaveBeenCalledWith('mr-1', dto, expect.objectContaining({ userId: 'admin-1' }));
  });

  it('delegates startWork, completeWork, confirmWork to service', async () => {
    const current = { userId: 'm-1', role: 'MAINTAINER' };
    await controller.startWork('mr-1', current as any, {});
    expect(service.startWork).toHaveBeenCalledWith('mr-1', expect.objectContaining({ userId: 'm-1' }), {});

    const compDto = { resolution: '换龙头' };
    await controller.completeWork('mr-1', current as any, compDto);
    expect(service.completeWork).toHaveBeenCalledWith('mr-1', expect.objectContaining({ userId: 'm-1' }), compDto);

    const confDto = { accepted: true };
    await controller.confirmWork('mr-1', current as any, confDto);
    expect(service.confirmWork).toHaveBeenCalledWith('mr-1', expect.objectContaining({ userId: 'm-1' }), confDto);
  });

  it('delegates transferExpense to service', async () => {
    const current = { userId: 'admin-1', role: 'ADMIN' };
    const dto = { dueDate: '2026-11-05' };
    await controller.transferExpense('mr-1', current as any, dto);
    expect(service.transferExpense).toHaveBeenCalledWith('mr-1', expect.objectContaining({ userId: 'admin-1' }), dto);
  });
});
