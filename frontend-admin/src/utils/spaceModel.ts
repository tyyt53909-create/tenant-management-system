import type { Building, Room } from '@/types';

/**
 * 房源空间视图的显示状态。
 *
 * 注意：这是一个**派生的展示状态**，不写回数据库。
 * 数据库仍然使用 Room.status + Room.cleanStatus 两个维度；
 * 空间视图只负责把它们合成管理者一眼能懂的一种颜色。
 */
export type SpaceState =
  | 'OCCUPIED'
  | 'RESERVED'
  | 'RENTABLE'
  | 'PENDING_CLEAN'
  | 'CLEANING'
  | 'MAINTENANCE'
  | 'UNKNOWN';

export interface SpaceStateMeta {
  /** 完整标签，用于图例、详情和提示 */
  label: string;
  /** 房间格内使用的短标签 */
  short: string;
  /** 主色，用于 2D/3D 房间体块 */
  color: string;
  /** 浅色底，用于 2D hover 或图例底色 */
  soft: string;
  /** 说明，帮助管理者理解「可租 / 待清洁」的差别 */
  description: string;
}

export const SPACE_STATE_ORDER: SpaceState[] = [
  'OCCUPIED',
  'RESERVED',
  'RENTABLE',
  'PENDING_CLEAN',
  'CLEANING',
  'MAINTENANCE',
  'UNKNOWN',
];

export const SPACE_STATE_META: Record<SpaceState, SpaceStateMeta> = {
  OCCUPIED: {
    label: '已出租',
    short: '已租',
    color: '#768168',
    soft: '#e7ece1',
    description: '当前有生效租约',
  },
  RESERVED: {
    label: '已预订',
    short: '预订',
    color: '#b87648',
    soft: '#f7e8d8',
    description: '已签合同，等待入住',
  },
  RENTABLE: {
    label: '可出租',
    short: '可租',
    color: '#5f7355',
    soft: '#edf3e7',
    description: '空置且已清洁，可立即出租',
  },
  PENDING_CLEAN: {
    label: '待清洁',
    short: '待清',
    color: '#b6844f',
    soft: '#fbf0df',
    description: '已退租或空置，等待清洁，暂不可出租',
  },
  CLEANING: {
    label: '清洁中',
    short: '清洁',
    color: '#5f7f91',
    soft: '#e8f0f4',
    description: '保洁正在处理',
  },
  MAINTENANCE: {
    label: '维修中',
    short: '维修',
    color: '#b35f55',
    soft: '#f8e5e1',
    description: '维修中，暂不可出租',
  },
  UNKNOWN: {
    label: '状态异常',
    short: '异常',
    color: '#8b8477',
    soft: '#eeeae3',
    description: '房态与清洁状态的组合无法识别',
  },
};

/** 空间视图使用的抽象平面坐标；2D/3D 渲染器只消费这一层。 */
export const SPACE_LAYOUT = {
  roomWidth: 4,
  roomDepth: 3,
  gapX: 0.85,
  /** 同一层折行时，两排房间之间的走廊宽度 */
  corridorGap: 1.8,
  /** 每层最多显示多少列，避免 20+ 间房被拉成一条薄片 */
  maxColumns: 12,
  /** 3D 楼层之间的垂直间距 */
  floorGap: 1.45,
  roomHeight: 2.15,
} as const;

export interface SpaceRoom {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: Room['roomType'];
  area?: number;
  status: Room['status'];
  cleanStatus: Room['cleanStatus'];
  state: SpaceState;
  tenantName?: string;
  contractStatus?: string;
  rentAmount?: number;
  contractStart?: string;
  contractEnd?: string;
  nextDue?: string;
  /** 平面坐标（抽象单位），x/y 是房间左上角 */
  x: number;
  y: number;
  /** 房间在本层的排数（0 开始），用于 2D 折行显示 */
  row: number;
  width: number;
  depth: number;
  /** 原始记录，详情面板和房态操作仍使用它 */
  room: Room;
}

export interface SpaceFloor {
  floor: number;
  /** 从下往上：0 = 最低层 */
  level: number;
  rooms: SpaceRoom[];
  columns: number;
  /** 本层折行后的排数 */
  rows: number;
  width: number;
  depth: number;
}

export interface SpaceSummary {
  total: number;
  occupied: number;
  reserved: number;
  rentable: number;
  pendingClean: number;
  cleaning: number;
  maintenance: number;
  unknown: number;
  occupancyRate: number;
  rentableRate: number;
}

export interface SpaceModel {
  buildingId: string;
  buildingName: string;
  address?: string;
  floors: SpaceFloor[];
  summary: SpaceSummary;
  /** 所有楼层对齐后的平面宽度（抽象单位） */
  width: number;
  depth: number;
  /** 楼层总高度（抽象单位），用于 3D 相机取景 */
  height: number;
}

type BuildingWithFloors = Building & { floors?: number };

/** 房号自然排序：101 < 102 < 1001，A101 也不会排到 101 后面。 */
export function compareRoomNumber(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/**
 * 把数据库两个维度的状态合成空间视图的单一显示状态。
 *
 * 已出租 / 已预订 / 维修中优先保留房态，因为它们是管理者最需要先看到的事实；
 * 空置房再按清洁状态细分「可出租 / 待清洁 / 清洁中」。
 */
export function toSpaceState(status?: string, cleanStatus?: string): SpaceState {
  if (status === 'OCCUPIED') return 'OCCUPIED';
  if (status === 'RESERVED') return 'RESERVED';
  if (status === 'MAINTENANCE') return 'MAINTENANCE';
  if (status === 'VACANT') {
    if (cleanStatus === 'CLEAN') return 'RENTABLE';
    if (cleanStatus === 'PENDING_CLEAN') return 'PENDING_CLEAN';
    if (cleanStatus === 'CLEANING') return 'CLEANING';
  }
  return 'UNKNOWN';
}

export const spaceStateOfRoom = (room: Pick<Room, 'status' | 'cleanStatus'>): SpaceState =>
  toSpaceState(room.status, room.cleanStatus);

function currentLease(room: Room) {
  return room.contracts?.find((contract) => contract.status === 'ACTIVE') ?? room.contracts?.[0];
}

function buildSummary(rooms: SpaceRoom[]): SpaceSummary {
  const counts: Record<SpaceState, number> = {
    OCCUPIED: 0,
    RESERVED: 0,
    RENTABLE: 0,
    PENDING_CLEAN: 0,
    CLEANING: 0,
    MAINTENANCE: 0,
    UNKNOWN: 0,
  };
  for (const room of rooms) counts[room.state] += 1;
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
}

/**
 * 由楼栋 + 房源列表构建空间模型。
 *
 * 这是一版**自动示意布局**：按楼层分组、房号自然排序、每层从左上角开始排列。
 * 它不声称代表真实方位；真实平面图后续通过 FloorPlan / RoomShape 替换几何部分。
 */
export function buildSpaceModel(building: BuildingWithFloors, rooms: Room[]): SpaceModel {
  const buildingFloors = Number(building.floors ?? building.totalFloors ?? 0) || 0;
  const roomFloors = rooms
    .map((room) => Number(room.floor))
    .filter((floor) => Number.isFinite(floor));
  const minFloor = Math.min(1, ...roomFloors);
  const maxFloor = Math.max(buildingFloors, ...roomFloors, 1);

  const roomsByFloor = new Map<number, Room[]>();
  for (const room of rooms) {
    const floor = Number(room.floor);
    const bucket = roomsByFloor.get(floor) ?? [];
    bucket.push(room);
    roomsByFloor.set(floor, bucket);
  }

  const columns = Math.min(
    SPACE_LAYOUT.maxColumns,
    Math.max(1, ...Array.from(roomsByFloor.values(), (floorRooms) => floorRooms.length)),
  );
  const width =
    columns * SPACE_LAYOUT.roomWidth + Math.max(0, columns - 1) * SPACE_LAYOUT.gapX;
  let depth: number = SPACE_LAYOUT.roomDepth;

  const floors: SpaceFloor[] = [];
  for (let floor = maxFloor; floor >= minFloor; floor -= 1) {
    const floorRooms = (roomsByFloor.get(floor) ?? [])
      .slice()
      .sort((a, b) => compareRoomNumber(a.roomNumber, b.roomNumber));
    const rows = Math.max(1, Math.ceil(floorRooms.length / columns));
    const floorDepth =
      rows * SPACE_LAYOUT.roomDepth + Math.max(0, rows - 1) * SPACE_LAYOUT.corridorGap;
    depth = Math.max(depth, floorDepth);

    const spaceRooms: SpaceRoom[] = floorRooms.map((room, index) => {
      const state = spaceStateOfRoom(room);
      // 只有已租、已预订或维修中的房间才展示租约信息；
      // 可出租/待清洁/清洁中的房源即使残留草稿合同，也不能在模型里显示成有人住。
      const lease =
        state === 'OCCUPIED' || state === 'RESERVED' || state === 'MAINTENANCE'
          ? currentLease(room)
          : undefined;
      const row = Math.floor(index / columns);
      return {
        id: room.id,
        roomNumber: room.roomNumber,
        floor: room.floor,
        roomType: room.roomType,
        area: room.area,
        status: room.status,
        cleanStatus: room.cleanStatus,
        state,
        tenantName: lease?.tenant?.name,
        contractStatus: lease?.status,
        rentAmount: lease?.rentAmount,
        contractStart: lease?.startDate,
        contractEnd: lease?.endDate,
        nextDue: lease?.bills?.[0]?.dueDate,
        x: (index % columns) * (SPACE_LAYOUT.roomWidth + SPACE_LAYOUT.gapX),
        y: row * (SPACE_LAYOUT.roomDepth + SPACE_LAYOUT.corridorGap),
        row,
        width: SPACE_LAYOUT.roomWidth,
        depth: SPACE_LAYOUT.roomDepth,
        room,
      };
    });

    floors.push({
      floor,
      level: Math.max(0, floor - minFloor),
      rooms: spaceRooms,
      columns,
      rows,
      width,
      depth: floorDepth,
    });
  }

  return {
    buildingId: building.id,
    buildingName: building.name,
    address: building.address,
    floors,
    summary: buildSummary(floors.flatMap((floor) => floor.rooms)),
    width,
    depth,
    height:
      floors.length * (SPACE_LAYOUT.roomHeight + SPACE_LAYOUT.floorGap) -
      SPACE_LAYOUT.floorGap,
  };
}
