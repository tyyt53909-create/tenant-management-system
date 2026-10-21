export interface SpaceShapeDto { kind: 'RECT'; x: number; y: number; width: number; depth: number }
export interface SpaceRoomDto {
  id: string; roomNumber: string; floor: number; shape: SpaceShapeDto;
  state: 'OCCUPIED' | 'RESERVED' | 'RENTABLE' | 'PENDING_CLEAN' | 'CLEANING' | 'MAINTENANCE' | 'UNKNOWN';
  alerts: []; version: number; tenantName?: string;
  lease?: { status: string; rentAmount: number; startDate: string; endDate: string };
}
export interface SpaceFloorDto {
  floor: number; level: number; layoutMode: 'AUTO'; width: number; depth: number; rooms: SpaceRoomDto[];
}
export interface SpaceModelDto {
  building: { id: string; name: string; address?: string; floors: number };
  view: 'ADMIN' | 'CLEANER' | 'TENANT' | 'PUBLIC'; layoutMode: 'AUTO';
  capabilities: { canSeeTenant: boolean; canSeeRent: boolean; canOperateStatus: boolean; canOperateCleaning: boolean };
  floors: SpaceFloorDto[];
  summary: { total: number; occupied: number; reserved: number; rentable: number; pendingClean: number; cleaning: number; maintenance: number; unknown: number; occupancyRate: number; rentableRate: number };
  generatedAt: string;
}
