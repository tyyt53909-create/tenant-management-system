import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SpaceModelDto, SpaceRoomDto } from './dto/space-response.dto.js';

const stateOf = (status: string, cleanStatus: string): SpaceRoomDto['state'] => {
  if (status === 'OCCUPIED') return 'OCCUPIED';
  if (status === 'RESERVED') return 'RESERVED';
  if (status === 'MAINTENANCE') return 'MAINTENANCE';
  if (status === 'VACANT') {
    if (cleanStatus === 'CLEAN') return 'RENTABLE';
    if (cleanStatus === 'PENDING_CLEAN') return 'PENDING_CLEAN';
    if (cleanStatus === 'CLEANING') return 'CLEANING';
  }
  return 'UNKNOWN';
};

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

@Injectable()
export class SpaceService {
  constructor(private readonly prisma: PrismaService) {}

  async getBuildingSpace(buildingId: string, role: string, tenantId?: string): Promise<SpaceModelDto> {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new NotFoundException('楼栋不存在');

    const where: Record<string, unknown> = { buildingId };
    if (role === 'CLEANER') Object.assign(where, { status: 'VACANT', cleanStatus: { in: ['PENDING_CLEAN', 'CLEANING'] } });
    if (role === 'TENANT') where.contracts = { some: { tenantId: tenantId || '__NO_TENANT_PROFILE__' } };
    if (role === 'PUBLIC') Object.assign(where, { status: 'VACANT', cleanStatus: 'CLEAN' });
    const rooms = await this.prisma.room.findMany({
      where,
      include: role === 'ADMIN' || role === 'TENANT' ? {
        contracts: { where: { status: { in: ['ACTIVE', 'DRAFT'] }, ...(role === 'TENANT' ? { tenantId: tenantId || '__NO_TENANT_PROFILE__' } : {}) }, orderBy: { createdAt: 'desc' }, take: 1, include: { tenant: { select: { name: true } } } },
      } : undefined,
    });

    const projected: SpaceRoomDto[] = rooms.map((room: any) => {
      const state = stateOf(room.status, room.cleanStatus);
      const result: SpaceRoomDto = {
        id: room.id, roomNumber: room.roomNumber, floor: room.floor,
        shape: { kind: 'RECT', x: 0, y: 0, width: 4, depth: 3 }, state, alerts: [], version: room.version,
      };
      if ((role === 'ADMIN' || role === 'TENANT') && ['OCCUPIED', 'RESERVED', 'MAINTENANCE'].includes(room.status)) {
        const contract = room.contracts?.[0];
        if (contract) {
          result.tenantName = contract.tenant.name;
          result.lease = { status: contract.status, rentAmount: Number(contract.rentAmount), startDate: new Date(contract.startDate).toISOString(), endDate: new Date(contract.endDate).toISOString() };
        }
      }
      return result;
    });
    const floorsWithRooms = [...new Set(projected.map((room) => room.floor))];
    const floorNumbers = role === 'ADMIN'
      ? Array.from({ length: Math.max(building.floors, ...floorsWithRooms, 0) }, (_, i) => i + 1)
      : floorsWithRooms;
    const floors = floorNumbers.sort((a, b) => b - a).map((floor, level) => {
      const floorRooms = projected.filter((room) => room.floor === floor).sort((a, b) => naturalCompare(a.roomNumber, b.roomNumber));
      // 让每层平面尽量接近方形，3D 模型才不会变成一条薄片。
      const columns = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(floorRooms.length * 2))));
      floorRooms.forEach((room, index) => { room.shape.x = (index % columns) * 4.85; room.shape.y = Math.floor(index / columns) * 4.8; });
      const rows = Math.ceil(floorRooms.length / columns);
      return { floor, level: floorNumbers.length - level - 1, layoutMode: 'AUTO' as const, width: Math.min(columns, floorRooms.length) * 4.85, depth: Math.max(1, rows) * 4.8, rooms: floorRooms };
    });
    const counts = { OCCUPIED: 0, RESERVED: 0, RENTABLE: 0, PENDING_CLEAN: 0, CLEANING: 0, MAINTENANCE: 0, UNKNOWN: 0 };
    projected.forEach((room) => counts[room.state]++);
    const total = projected.length;
    const capabilities = {
      canSeeTenant: role === 'ADMIN' || role === 'TENANT', canSeeRent: role === 'ADMIN' || role === 'TENANT',
      canOperateStatus: role === 'ADMIN', canOperateCleaning: role === 'ADMIN' || role === 'CLEANER',
    };
    return {
      building: { id: building.id, name: building.name, ...(role === 'ADMIN' && building.address ? { address: building.address } : {}), floors: building.floors },
      view: role as SpaceModelDto['view'], layoutMode: 'AUTO', capabilities, floors,
      summary: { total, occupied: counts.OCCUPIED, reserved: counts.RESERVED, rentable: counts.RENTABLE, pendingClean: counts.PENDING_CLEAN, cleaning: counts.CLEANING, maintenance: counts.MAINTENANCE, unknown: counts.UNKNOWN, occupancyRate: total ? counts.OCCUPIED / total * 100 : 0, rentableRate: total ? counts.RENTABLE / total * 100 : 0 },
      generatedAt: new Date().toISOString(),
    };
  }
}
