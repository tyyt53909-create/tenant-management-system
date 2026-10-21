import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SpaceService } from './space.service.js';

const building = { id: 'b1', name: 'Building', address: 'private address', floors: 3 };
const mkRoom = (id: string, roomNumber: string, floor: number, status: string, cleanStatus = 'CLEAN', contracts: any[] = []) => ({ id, roomNumber, floor, status, cleanStatus, version: 2, contracts });
const createService = (rooms: any[]) => {
  const prisma: any = { building: { findUnique: vi.fn().mockResolvedValue(building) }, room: { findMany: vi.fn().mockResolvedValue(rooms) } };
  return { service: new SpaceService(prisma), prisma };
};

describe('SpaceService', () => {
  it('returns full ADMIN view, six-state mapping, naturally sorted AUTO geometry and empty floors', async () => {
    const rooms = [
      mkRoom('10', '102', 1, 'OCCUPIED', 'CLEAN', [{ status: 'ACTIVE', rentAmount: 200, startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), tenant: { name: 'Tenant' } }]),
      mkRoom('2', '101', 1, 'RESERVED'), mkRoom('3', '103', 1, 'VACANT'),
      mkRoom('4', '104', 1, 'VACANT', 'PENDING_CLEAN'), mkRoom('5', '105', 1, 'VACANT', 'CLEANING'),
      mkRoom('6', '106', 1, 'MAINTENANCE'), mkRoom('7', '107', 1, 'OTHER'),
    ];
    const { service } = createService(rooms);
    const result = await service.getBuildingSpace('b1', 'ADMIN');
    expect(result.floors).toHaveLength(3);
    expect(result.floors[2]?.rooms.map((room) => room.roomNumber)).toEqual(['101', '102', '103', '104', '105', '106', '107']);
    expect(result.floors[2]?.rooms.map((room) => room.state)).toEqual(['RESERVED', 'OCCUPIED', 'RENTABLE', 'PENDING_CLEAN', 'CLEANING', 'MAINTENANCE', 'UNKNOWN']);
    expect(result.summary.total).toBe(7);
    expect(result.floors[2]?.rooms[1]?.tenantName).toBe('Tenant');
    expect(result.building.address).toBe('private address');
  });

  it('server-filters cleaner rooms and excludes tenant and rent data', async () => {
    const { service, prisma } = createService([mkRoom('c1', '201', 2, 'VACANT', 'PENDING_CLEAN'), mkRoom('c2', '202', 2, 'VACANT', 'CLEANING')]);
    const result = await service.getBuildingSpace('b1', 'CLEANER');
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ buildingId: 'b1', status: 'VACANT', cleanStatus: { in: ['PENDING_CLEAN', 'CLEANING'] } });
    expect(result.floors.flatMap((floor) => floor.rooms).every((room) => !('tenantName' in room) && !('lease' in room))).toBe(true);
  });

  it('scopes TENANT rooms and contracts to own tenant id', async () => {
    const { service, prisma } = createService([mkRoom('t1', '301', 3, 'OCCUPIED')]);
    await service.getBuildingSpace('b1', 'TENANT', 'tenant-1');
    const query = prisma.room.findMany.mock.calls[0][0];
    expect(query.where.contracts.some.tenantId).toBe('tenant-1');
    expect(query.include.contracts.where.tenantId).toBe('tenant-1');
  });

  it('public view includes only rentable rooms and hides private building address', async () => {
    const { service, prisma } = createService([mkRoom('p1', '401', 4, 'VACANT', 'CLEAN')]);
    const result = await service.getBuildingSpace('b1', 'PUBLIC');
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ buildingId: 'b1', status: 'VACANT', cleanStatus: 'CLEAN' });
    expect(result.building.address).toBeUndefined();
    expect(result.floors[0]?.rooms[0]).not.toHaveProperty('lease');
    expect(result.capabilities.canSeeRent).toBe(false);
  });

  it('returns 404 for an unknown building', async () => {
    const { service } = createService([]);
    (service as any).prisma.building.findUnique.mockResolvedValue(null);
    await expect(service.getBuildingSpace('missing', 'ADMIN')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wraps AUTO layout after twelve columns, including long room numbers', async () => {
    const rooms = Array.from({ length: 13 }, (_, index) => mkRoom(String(index), `A${String(index + 1).padStart(2, '0')}-LONG-ROOM`, 1, 'VACANT'));
    const { service } = createService(rooms);
    const result = await service.getBuildingSpace('b1', 'ADMIN');
    const laidOut = result.floors[2]?.rooms ?? [];
    expect(Math.max(...laidOut.map((room) => room.shape.x / 4.85))).toBe(11);
    expect(laidOut.some((room) => room.shape.y > 0)).toBe(true);
  });
});
