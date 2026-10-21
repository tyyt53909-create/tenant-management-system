import { describe, expect, it } from 'vitest';
import type { Building, Room } from '@/types';
import {
  SPACE_LAYOUT,
  buildSpaceModel,
  compareRoomNumber,
  toSpaceState,
} from './spaceModel';

const room = (overrides: Partial<Room>): Room =>
  ({
    id: 'room-1',
    buildingId: 'building-1',
    roomNumber: '101',
    floor: 1,
    roomType: 'SINGLE',
    area: 20,
    facilities: [],
    status: 'VACANT',
    cleanStatus: 'CLEAN',
    version: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }) as Room;

const building = {
  id: 'building-1',
  name: '栖居一号楼',
  address: '测试路 1 号',
  totalFloors: 3,
  floors: 3,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as Building & { floors: number };

describe('toSpaceState', () => {
  it('把六种合法组合映射成六种空间显示状态', () => {
    expect(toSpaceState('OCCUPIED', 'CLEAN')).toBe('OCCUPIED');
    expect(toSpaceState('RESERVED', 'CLEAN')).toBe('RESERVED');
    expect(toSpaceState('VACANT', 'CLEAN')).toBe('RENTABLE');
    expect(toSpaceState('VACANT', 'PENDING_CLEAN')).toBe('PENDING_CLEAN');
    expect(toSpaceState('VACANT', 'CLEANING')).toBe('CLEANING');
    expect(toSpaceState('MAINTENANCE', 'CLEAN')).toBe('MAINTENANCE');
  });

  it('待清洁与可出租绝不混为一谈', () => {
    expect(toSpaceState('VACANT', 'PENDING_CLEAN')).not.toBe(
      toSpaceState('VACANT', 'CLEAN'),
    );
  });

  it('未知组合回退为状态异常，而不是猜成空置', () => {
    expect(toSpaceState('VACANT', 'UNKNOWN')).toBe('UNKNOWN');
    expect(toSpaceState(undefined, undefined)).toBe('UNKNOWN');
  });
});

describe('compareRoomNumber', () => {
  it('按数字自然排序，而不是字典序', () => {
    const numbers = ['1001', '101', '10', '102'].sort(compareRoomNumber);
    expect(numbers).toEqual(['10', '101', '102', '1001']);
  });
});

describe('buildSpaceModel', () => {
  it('按楼层分组、房号排序，并生成对齐的平面坐标', () => {
    const model = buildSpaceModel(building, [
      room({ id: 'r-103', roomNumber: '103', floor: 1 }),
      room({ id: 'r-101', roomNumber: '101', floor: 1 }),
      room({ id: 'r-201', roomNumber: '201', floor: 2 }),
    ]);

    expect(model.floors.map((floor) => floor.floor)).toEqual([3, 2, 1]);
    const firstFloor = model.floors.find((floor) => floor.floor === 1)!;
    expect(firstFloor.rooms.map((item) => item.roomNumber)).toEqual(['101', '103']);
    expect(firstFloor.rooms[0]!.x).toBe(0);
    expect(firstFloor.rooms[1]!.x).toBe(
      SPACE_LAYOUT.roomWidth + SPACE_LAYOUT.gapX,
    );
    expect(firstFloor.width).toBe(model.width);
    expect(model.floors.find((floor) => floor.floor === 3)!.rooms).toHaveLength(0);
  });

  it('汇总已租、可租、待清洁、清洁中、维修与异常', () => {
    const model = buildSpaceModel(building, [
      room({ id: 'occupied', status: 'OCCUPIED', cleanStatus: 'CLEAN' }),
      room({ id: 'reserved', roomNumber: '102', status: 'RESERVED', cleanStatus: 'CLEAN' }),
      room({ id: 'rentable', roomNumber: '103', status: 'VACANT', cleanStatus: 'CLEAN' }),
      room({ id: 'pending', roomNumber: '104', status: 'VACANT', cleanStatus: 'PENDING_CLEAN' }),
      room({ id: 'cleaning', roomNumber: '105', status: 'VACANT', cleanStatus: 'CLEANING' }),
      room({ id: 'maintenance', roomNumber: '106', status: 'MAINTENANCE', cleanStatus: 'CLEAN' }),
      room({ id: 'unknown', roomNumber: '107', status: 'VACANT', cleanStatus: 'UNKNOWN' as never }),
    ]);

    expect(model.summary).toMatchObject({
      total: 7,
      occupied: 1,
      reserved: 1,
      rentable: 1,
      pendingClean: 1,
      cleaning: 1,
      maintenance: 1,
      unknown: 1,
    });
    expect(model.summary.occupancyRate).toBeCloseTo(100 / 7);
  });

  it('可出租房间即使残留草稿合同，也不在模型里显示租客', () => {
    const model = buildSpaceModel(building, [
      room({
        status: 'VACANT',
        cleanStatus: 'CLEAN',
        contracts: [
          {
            id: 'c-1',
            contractNumber: 'DRAFT-1',
            status: 'DRAFT',
            rentAmount: 300000,
            startDate: '2026-11-01',
            endDate: '2027-11-01',
            tenant: { name: '草稿租客' },
          },
        ],
      } as never),
    ]);
    const firstFloor = model.floors.find((floor) => floor.floor === 1)!;
    expect(firstFloor.rooms[0]!.state).toBe('RENTABLE');
    expect(firstFloor.rooms[0]!.tenantName).toBeUndefined();
  });

  it('每层超过 12 间时折行，避免 3D 模型被拉成一条薄片', () => {
    const rooms = Array.from({ length: 25 }, (_, index) =>
      room({
        id: `r-${index}`,
        roomNumber: String(101 + index),
        floor: 1,
      }),
    );
    const model = buildSpaceModel(building, rooms);
    const firstFloor = model.floors.find((floor) => floor.floor === 1)!;
    expect(firstFloor.columns).toBe(12);
    expect(firstFloor.rows).toBe(3);
    expect(firstFloor.rooms[12]!.row).toBe(1);
    expect(firstFloor.rooms[24]!.row).toBe(2);
    expect(firstFloor.depth).toBeGreaterThan(SPACE_LAYOUT.roomDepth);
    expect(model.depth).toBe(firstFloor.depth);
  });

  it('没有房源时仍返回楼层骨架，不伪造房间', () => {
    const model = buildSpaceModel(building, []);
    expect(model.floors).toHaveLength(3);
    expect(model.summary.total).toBe(0);
    expect(model.floors.every((floor) => floor.rooms.length === 0)).toBe(true);
  });
});
