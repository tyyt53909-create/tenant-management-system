import { Test, TestingModule } from '@nestjs/testing';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

describe('StaffController', () => {
  let controller: StaffController;
  let service: any;

  beforeEach(async () => {
    service = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      create: vi.fn().mockResolvedValue({ id: 's1', role: 'PROPERTY_MANAGER' }),
      findOne: vi.fn().mockResolvedValue({ id: 's1' }),
      update: vi.fn().mockResolvedValue({ id: 's1' }),
      resetPassword: vi.fn().mockResolvedValue({ message: '密码已重置' }),
      assignBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
      getAssignedBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
      getMyBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StaffController],
      providers: [{ provide: StaffService, useValue: service }],
    }).compile();

    controller = module.get<StaffController>(StaffController);
  });

  it('list delegates to service', async () => {
    expect(await controller.list({})).toEqual({ items: [], total: 0 });
    expect(service.list).toHaveBeenCalledWith({});
  });

  it('create delegates to service with operator ID', async () => {
    const dto = { email: 'pm@example.com', password: '{{SECRET_1c0wz9ea}}', role: 'PROPERTY_MANAGER' as const };
    const current = { userId: 'admin-1', role: 'ADMIN' };
    expect(await controller.create(dto, current as any)).toEqual({ id: 's1', role: 'PROPERTY_MANAGER' });
    expect(service.create).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('getMyBuildings delegates to service with current user id and role', async () => {
    const current = { userId: 'pm-1', role: 'PROPERTY_MANAGER' };
    expect(await controller.getMyBuildings(current as any)).toEqual([{ id: 'b1' }]);
    expect(service.getMyBuildings).toHaveBeenCalledWith('pm-1', 'PROPERTY_MANAGER');
  });

  it('findOne delegates to service', async () => {
    expect(await controller.findOne('s1')).toEqual({ id: 's1' });
    expect(service.findOne).toHaveBeenCalledWith('s1');
  });

  it('update delegates to service with actor ID', async () => {
    const dto = { role: 'CLEANER' as const };
    const current = { userId: 'admin-1', role: 'ADMIN' };
    expect(await controller.update('s1', current as any, dto)).toEqual({ id: 's1' });
    expect(service.update).toHaveBeenCalledWith('s1', 'admin-1', dto);
  });

  it('resetPassword delegates to service', async () => {
    expect(await controller.resetPassword('s1', { newPassword: 'new-pass-123' })).toEqual({ message: '密码已重置' });
    expect(service.resetPassword).toHaveBeenCalledWith('s1', { newPassword: 'new-pass-123' });
  });

  it('assignBuildings and getAssignedBuildings delegate to service', async () => {
    const current = { userId: 'admin-1', role: 'ADMIN' };
    expect(await controller.assignBuildings('s1', { buildingIds: ['b1'] }, current as any)).toEqual([{ id: 'b1' }]);
    expect(service.assignBuildings).toHaveBeenCalledWith('s1', { buildingIds: ['b1'] }, 'admin-1');

    expect(await controller.getAssignedBuildings('s1')).toEqual([{ id: 'b1' }]);
    expect(service.getAssignedBuildings).toHaveBeenCalledWith('s1');
  });
});
