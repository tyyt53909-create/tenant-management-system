/**
 * 房源模型接口契約 v1。
 *
 * 這是 T221 起前後端共用的資料形狀；目前 T220 的 `utils/spaceModel.ts`
 * 仍使用內部舊形狀，WP-03 會負責把頁面切換到本契約。
 *
 * 契約文件：docs/16-房源模型接口契约.md
 */
export type SpaceView = 'ADMIN' | 'CLEANER' | 'TENANT' | 'PUBLIC';

export type SpaceState =
  | 'OCCUPIED'
  | 'RESERVED'
  | 'RENTABLE'
  | 'PENDING_CLEAN'
  | 'CLEANING'
  | 'MAINTENANCE'
  | 'UNKNOWN';

export type SpaceShape =
  | { kind: 'RECT'; x: number; y: number; width: number; depth: number }
  | { kind: 'POLYGON'; points: [number, number][] };

export interface SpaceAlert {
  type: 'OVERDUE' | 'EXPIRING' | 'REPAIR';
  label?: string;
  severity?: 'info' | 'warning' | 'danger';
}

export interface SpaceCapabilities {
  canSeeTenant: boolean;
  canSeeRent: boolean;
  canOperateStatus: boolean;
  canOperateCleaning: boolean;
}

export interface SpaceLease {
  status: string;
  rentAmount: number;
  startDate: string;
  endDate: string;
}

export interface SpaceRoomContract {
  id: string;
  roomNumber: string;
  floor: number;
  shape: SpaceShape;
  state: SpaceState;
  alerts: SpaceAlert[];
  version: number;
  unplaced?: boolean;
  tenantName?: string;
  lease?: SpaceLease;
}

export interface SpaceFloorContract {
  floor: number;
  /** 0 = 最低層 */
  level: number;
  layoutMode: 'AUTO' | 'AUTHORED';
  width: number;
  depth: number;
  rooms: SpaceRoomContract[];
}

export interface SpaceSummaryContract {
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

export interface SpaceBuildingContract {
  id: string;
  name: string;
  address?: string;
  floors: number;
}

export interface SpaceModelContract {
  building: SpaceBuildingContract;
  view: SpaceView;
  layoutMode: 'AUTO' | 'AUTHORED' | 'MIXED';
  capabilities: SpaceCapabilities;
  floors: SpaceFloorContract[];
  summary: SpaceSummaryContract;
  generatedAt: string;
}

/** 小區模型使用：每棟樓的摘要，不帶房間明細。 */
export interface CampusBuildingSummary {
  id: string;
  name: string;
  floors: number;
  total: number;
  rentable: number;
  occupied: number;
  reserved: number;
  pendingClean: number;
  cleaning: number;
  maintenance: number;
}
