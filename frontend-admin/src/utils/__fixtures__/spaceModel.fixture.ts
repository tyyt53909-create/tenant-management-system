import type {
  SpaceBuildingContract,
  SpaceCapabilities,
  SpaceFloorContract,
  SpaceModelContract,
  SpaceRoomContract,
  SpaceState,
  SpaceSummaryContract,
} from '@/types/space';

const ADMIN_CAPABILITIES: SpaceCapabilities = {
  canSeeTenant: true,
  canSeeRent: true,
  canOperateStatus: true,
  canOperateCleaning: true,
};

const CLEANER_CAPABILITIES: SpaceCapabilities = {
  canSeeTenant: false,
  canSeeRent: false,
  canOperateStatus: false,
  canOperateCleaning: true,
};

const TENANT_CAPABILITIES: SpaceCapabilities = {
  canSeeTenant: true,
  canSeeRent: true,
  canOperateStatus: false,
  canOperateCleaning: false,
};

const PUBLIC_CAPABILITIES: SpaceCapabilities = {
  canSeeTenant: false,
  canSeeRent: false,
  canOperateStatus: false,
  canOperateCleaning: false,
};

const BUILDING: SpaceBuildingContract = {
  id: 'fixture-building',
  name: '栖居测试楼',
  address: '测试路 1 号',
  floors: 4,
};

const rect = (x: number, y: number, width = 4, depth = 3) =>
  ({ kind: 'RECT' as const, x, y, width, depth });

const room = (
  overrides: Partial<SpaceRoomContract> & Pick<SpaceRoomContract, 'id' | 'roomNumber' | 'floor'>,
): SpaceRoomContract => ({
  shape: rect(0, 0),
  state: 'RENTABLE',
  alerts: [],
  version: 1,
  ...overrides,
});

const summary = (rooms: SpaceRoomContract[]): SpaceSummaryContract => {
  const counts: Record<SpaceState, number> = {
    OCCUPIED: 0,
    RESERVED: 0,
    RENTABLE: 0,
    PENDING_CLEAN: 0,
    CLEANING: 0,
    MAINTENANCE: 0,
    UNKNOWN: 0,
  };
  for (const item of rooms) counts[item.state] += 1;
  const total = rooms.length;
  return {
    total,
    occupied: counts.OCCUPIED,
    reserved: counts.RESERVED,
    rentable: counts.RENTABLE,
    pendingClean: counts.PENDING_CLEAN,
    cleaning: counts.CLEANING,
    maintenance: counts.MAINTENANCE,
    unknown: counts.UNKNOWN,
    occupancyRate: total ? (counts.OCCUPIED / total) * 100 : 0,
    rentableRate: total ? (counts.RENTABLE / total) * 100 : 0,
  };
};

const floor = (
  floorNumber: number,
  level: number,
  rooms: SpaceRoomContract[],
  layoutMode: 'AUTO' | 'AUTHORED' = 'AUTO',
): SpaceFloorContract => ({
  floor: floorNumber,
  level,
  layoutMode,
  width: 24,
  depth: 8,
  rooms,
});

const autoFloors: SpaceFloorContract[] = [
  floor(4, 3, []),
  floor(3, 2, [
    room({
      id: 'auto-301',
      roomNumber: '301',
      floor: 3,
      shape: rect(0, 0),
      state: 'OCCUPIED',
      tenantName: '林小姐',
      lease: {
        status: 'ACTIVE',
        rentAmount: 420000,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
      },
    }),
    room({
      id: 'auto-302',
      roomNumber: '302',
      floor: 3,
      shape: rect(4.85, 0),
      state: 'RESERVED',
      tenantName: '陈先生',
      lease: {
        status: 'DRAFT',
        rentAmount: 380000,
        startDate: '2026-12-01',
        endDate: '2027-12-01',
      },
      alerts: [{ type: 'EXPIRING', label: '待入住' }],
    }),
    room({
      id: 'auto-303',
      roomNumber: '303',
      floor: 3,
      shape: rect(9.7, 0),
      state: 'RENTABLE',
    }),
  ]),
  floor(2, 1, [
    room({
      id: 'auto-201',
      roomNumber: '201',
      floor: 2,
      shape: rect(0, 0),
      state: 'PENDING_CLEAN',
      alerts: [{ type: 'REPAIR', label: '退租待清' }],
    }),
    room({
      id: 'auto-202',
      roomNumber: '202',
      floor: 2,
      shape: rect(4.85, 0),
      state: 'CLEANING',
    }),
    room({
      id: 'auto-203',
      roomNumber: '203',
      floor: 2,
      shape: rect(9.7, 0),
      state: 'MAINTENANCE',
      alerts: [{ type: 'REPAIR', label: '水管维修' }],
    }),
  ]),
  floor(1, 0, [
    room({
      id: 'auto-101',
      roomNumber: 'PW2b8oy7h7B',
      floor: 1,
      shape: rect(0, 0),
      state: 'UNKNOWN',
    }),
    room({
      id: 'auto-102',
      roomNumber: '102',
      floor: 1,
      shape: rect(4.85, 0),
      state: 'OCCUPIED',
      tenantName: '周先生',
      lease: {
        status: 'ACTIVE',
        rentAmount: 360000,
        startDate: '2026-03-01',
        endDate: '2027-03-01',
      },
      alerts: [{ type: 'OVERDUE', label: '账单逾期', severity: 'danger' }],
    }),
  ]),
];

export const autoSpaceFixture: SpaceModelContract = {
  building: BUILDING,
  view: 'ADMIN',
  layoutMode: 'AUTO',
  capabilities: ADMIN_CAPABILITIES,
  floors: autoFloors,
  summary: summary(autoFloors.flatMap((item) => item.rooms)),
  generatedAt: '2026-10-21T00:00:00.000Z',
};

const authoredFloors: SpaceFloorContract[] = [
  floor(
    2,
    1,
    [
      room({
        id: 'authored-201',
        roomNumber: '201',
        floor: 2,
        shape: {
          kind: 'POLYGON',
          points: [
            [0, 0],
            [10, 0],
            [10, 7],
            [5, 9],
            [0, 7],
          ],
        },
        state: 'RENTABLE',
      }),
      room({
        id: 'authored-202',
        roomNumber: '202',
        floor: 2,
        shape: rect(11, 0, 5, 4),
        state: 'OCCUPIED',
        tenantName: '测试租客',
        lease: {
          status: 'ACTIVE',
          rentAmount: 250000,
          startDate: '2026-06-01',
          endDate: '2027-06-01',
        },
      }),
      room({
        id: 'authored-203',
        roomNumber: '203',
        floor: 2,
        shape: rect(11, 5, 5, 4),
        state: 'PENDING_CLEAN',
      }),
    ],
    'AUTHORED',
  ),
  floor(
    1,
    0,
    [
      room({
        id: 'authored-101',
        roomNumber: '101',
        floor: 1,
        shape: rect(0, 0, 6, 4),
        state: 'RENTABLE',
      }),
      room({
        id: 'authored-unplaced',
        roomNumber: '102',
        floor: 1,
        shape: rect(0, 0, 4, 3),
        state: 'MAINTENANCE',
        unplaced: true,
      }),
    ],
    'AUTHORED',
  ),
];

export const authoredSpaceFixture: SpaceModelContract = {
  building: {
    id: 'fixture-authored-building',
    name: '栖居平面图楼',
    address: '测试路 2 号',
    floors: 2,
  },
  view: 'ADMIN',
  layoutMode: 'AUTHORED',
  capabilities: ADMIN_CAPABILITIES,
  floors: authoredFloors,
  summary: summary(authoredFloors.flatMap((item) => item.rooms)),
  generatedAt: '2026-10-21T00:00:00.000Z',
};

const stateCycle: SpaceState[] = [
  'OCCUPIED',
  'RENTABLE',
  'PENDING_CLEAN',
  'CLEANING',
  'MAINTENANCE',
  'RESERVED',
];

const makeLargeFloor = (floorNumber: number, level: number): SpaceFloorContract => {
  const rooms = Array.from({ length: 24 }, (_, index) => {
    const state = stateCycle[(floorNumber * 24 + index) % stateCycle.length]!;
    return room({
      id: `large-${floorNumber}-${index}`,
      roomNumber: `${floorNumber}${String(index + 1).padStart(2, '0')}`,
      floor: floorNumber,
      shape: rect(
        (index % 12) * 4.85,
        Math.floor(index / 12) * 4.8,
      ),
      state,
    });
  });
  return floor(floorNumber, level, rooms, 'AUTO');
};

const largeFloors = Array.from({ length: 7 }, (_, index) =>
  makeLargeFloor(index + 1, index),
).reverse();

export const largeSpaceFixture: SpaceModelContract = {
  building: {
    id: 'fixture-large-building',
    name: '栖居大型测试楼',
    address: '测试路 3 号',
    floors: 7,
  },
  view: 'ADMIN',
  layoutMode: 'AUTO',
  capabilities: ADMIN_CAPABILITIES,
  floors: largeFloors,
  summary: summary(largeFloors.flatMap((item) => item.rooms)),
  generatedAt: '2026-10-21T00:00:00.000Z',
};

const roleFloor = (rooms: SpaceRoomContract[]): SpaceFloorContract => floor(2, 1, rooms, 'AUTO');

export const cleanerSpaceFixture: SpaceModelContract = {
  building: { ...BUILDING, id: 'fixture-cleaner-building', name: '栖居保洁测试楼' },
  view: 'CLEANER',
  layoutMode: 'AUTO',
  capabilities: CLEANER_CAPABILITIES,
  floors: [
    roleFloor([
      room({
        id: 'cleaner-201',
        roomNumber: '201',
        floor: 2,
        state: 'PENDING_CLEAN',
        shape: rect(0, 0),
      }),
      room({
        id: 'cleaner-202',
        roomNumber: '202',
        floor: 2,
        state: 'CLEANING',
        shape: rect(4.85, 0),
      }),
    ]),
  ],
  summary: summary([
    room({ id: 'cleaner-201', roomNumber: '201', floor: 2, state: 'PENDING_CLEAN' }),
    room({ id: 'cleaner-202', roomNumber: '202', floor: 2, state: 'CLEANING' }),
  ]),
  generatedAt: '2026-10-21T00:00:00.000Z',
};

export const tenantSpaceFixture: SpaceModelContract = {
  building: { ...BUILDING, id: 'fixture-tenant-building', name: '栖居租客测试楼' },
  view: 'TENANT',
  layoutMode: 'AUTO',
  capabilities: TENANT_CAPABILITIES,
  floors: [
    roleFloor([
      room({
        id: 'tenant-201',
        roomNumber: '201',
        floor: 2,
        state: 'OCCUPIED',
        shape: rect(0, 0),
        lease: {
          status: 'ACTIVE',
          rentAmount: 300000,
          startDate: '2026-01-01',
          endDate: '2027-01-01',
        },
      }),
    ]),
  ],
  summary: summary([
    room({ id: 'tenant-201', roomNumber: '201', floor: 2, state: 'OCCUPIED' }),
  ]),
  generatedAt: '2026-10-21T00:00:00.000Z',
};

export const publicSpaceFixture: SpaceModelContract = {
  building: { ...BUILDING, id: 'fixture-public-building', name: '栖居公开测试楼' },
  view: 'PUBLIC',
  layoutMode: 'AUTO',
  capabilities: PUBLIC_CAPABILITIES,
  floors: [
    roleFloor([
      room({
        id: 'public-201',
        roomNumber: '201',
        floor: 2,
        state: 'RENTABLE',
        shape: rect(0, 0),
      }),
      room({
        id: 'public-202',
        roomNumber: '202',
        floor: 2,
        state: 'RENTABLE',
        shape: rect(4.85, 0),
      }),
    ]),
  ],
  summary: summary([
    room({ id: 'public-201', roomNumber: '201', floor: 2, state: 'RENTABLE' }),
    room({ id: 'public-202', roomNumber: '202', floor: 2, state: 'RENTABLE' }),
  ]),
  generatedAt: '2026-10-21T00:00:00.000Z',
};
