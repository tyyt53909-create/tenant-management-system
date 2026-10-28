import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CleaningController } from './cleaning.controller.js';
import { CleaningService } from './cleaning.service.js';

describe('CleaningController (WRK-03 / T304)', () => {
  let controller: CleaningController;
  let service: any;

  beforeEach(() => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'task-1' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: {} }),
      findAssignedToCleaner: vi.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: vi.fn().mockResolvedValue({ id: 'task-1' }),
      assignCleaner: vi.fn().mockResolvedValue({ id: 'task-1', status: 'ASSIGNED' }),
      startCleaning: vi.fn().mockResolvedValue({ id: 'task-1', status: 'IN_PROGRESS' }),
      completeCleaning: vi.fn().mockResolvedValue({ id: 'task-1', status: 'COMPLETED' }),
      acceptCleaning: vi.fn().mockResolvedValue({ id: 'task-1', status: 'ACCEPTED' }),
      rejectCleaning: vi.fn().mockResolvedValue({ id: 'task-1', status: 'IN_PROGRESS' }),
      cancel: vi.fn().mockResolvedValue({ id: 'task-1', status: 'CANCELLED' }),
    };

    controller = new CleaningController(service as CleaningService);
  });

  it('create 应该委托 service.create', async () => {
    const dto = { roomId: 'r1' };
    const res = await controller.create({ userId: 'u1', role: 'ADMIN' }, dto);
    expect(res).toEqual({ id: 'task-1' });
    expect(service.create).toHaveBeenCalledWith(dto, expect.objectContaining({ userId: 'u1' }));
  });

  it('findAll 应该委托 service.findAll', async () => {
    const query = { page: 1, limit: 10 };
    await controller.findAll({ userId: 'u1', role: 'ADMIN' }, query);
    expect(service.findAll).toHaveBeenCalledWith(query, expect.objectContaining({ userId: 'u1' }));
  });

  it('findAssigned 应该委托 service.findAssignedToCleaner', async () => {
    await controller.findAssigned({ userId: 'cleaner-1', role: 'CLEANER' }, {});
    expect(service.findAssignedToCleaner).toHaveBeenCalledWith('cleaner-1', {});
  });

  it('assign 应该委托 service.assignCleaner', async () => {
    await controller.assign({ userId: 'admin', role: 'ADMIN' }, 't1', { cleanerId: 'c1' });
    expect(service.assignCleaner).toHaveBeenCalledWith('t1', { cleanerId: 'c1' }, expect.objectContaining({ userId: 'admin' }));
  });

  it('start 应该委托 service.startCleaning', async () => {
    await controller.start({ userId: 'c1', role: 'CLEANER' }, 't1');
    expect(service.startCleaning).toHaveBeenCalledWith('t1', expect.objectContaining({ userId: 'c1' }));
  });

  it('complete 应该委托 service.completeCleaning', async () => {
    const dto = { afterPhotos: ['pic.jpg'] };
    await controller.complete({ userId: 'c1', role: 'CLEANER' }, 't1', dto);
    expect(service.completeCleaning).toHaveBeenCalledWith('t1', dto, expect.objectContaining({ userId: 'c1' }));
  });

  it('accept 应该委托 service.acceptCleaning', async () => {
    const dto = { rating: 5 };
    await controller.accept({ userId: 'admin', role: 'ADMIN' }, 't1', dto);
    expect(service.acceptCleaning).toHaveBeenCalledWith('t1', dto, expect.objectContaining({ userId: 'admin' }));
  });

  it('reject 应该委托 service.rejectCleaning', async () => {
    const dto = { reason: '未擦玻璃' };
    await controller.reject({ userId: 'admin', role: 'ADMIN' }, 't1', dto);
    expect(service.rejectCleaning).toHaveBeenCalledWith('t1', dto, expect.objectContaining({ userId: 'admin' }));
  });

  it('cancel 应该委托 service.cancel', async () => {
    await controller.cancel({ userId: 'admin', role: 'ADMIN' }, 't1');
    expect(service.cancel).toHaveBeenCalledWith('t1', expect.objectContaining({ userId: 'admin' }));
  });
});
