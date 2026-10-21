import type { SpaceFloorContract, SpaceModelContract, SpaceRoomContract, SpaceState } from '@/types/space';

export const CONTRACT_STATE_META: Record<SpaceState, { label: string; short: string; color: string; soft: string }> = {
  OCCUPIED: { label: '已出租', short: '已租', color: '#5f7f9b', soft: '#e8eef4' },
  RESERVED: { label: '已预订', short: '预订', color: '#8b7398', soft: '#f1ebf4' },
  RENTABLE: { label: '可出租', short: '可租', color: '#5f8f5a', soft: '#e7f2e3' },
  PENDING_CLEAN: { label: '待清洁', short: '待清', color: '#d47a55', soft: '#fbeae3' },
  CLEANING: { label: '清洁中', short: '清洁', color: '#c45d4c', soft: '#f9e5e1' },
  MAINTENANCE: { label: '维修中', short: '维修', color: '#a6473c', soft: '#f6dfdb' },
  UNKNOWN: { label: '状态异常', short: '异常', color: '#8b8477', soft: '#eeeae3' },
};

export interface ContractRenderRoom extends SpaceRoomContract { label: string }
export interface ContractRenderFloor extends Omit<SpaceFloorContract, 'rooms'> {
  rooms: ContractRenderRoom[];
  unplacedRooms: ContractRenderRoom[];
}
export interface SpaceContractRenderModel extends Omit<SpaceModelContract, 'floors'> {
  floors: ContractRenderFloor[];
}

export function compareContractRoomNumber(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

export function contractRoomLabel(roomNumber: string): string {
  const value = roomNumber || '—';
  return value.length > 5 ? `…${value.slice(-4)}` : value;
}

export function buildSpaceContractModel(model: SpaceModelContract): SpaceContractRenderModel {
  return {
    ...model,
    floors: [...model.floors]
      .sort((a, b) => b.level - a.level)
      .map((floor) => {
        const sorted = floor.rooms.slice().sort((a, b) => compareContractRoomNumber(a.roomNumber, b.roomNumber));
        const rooms = sorted.filter((room) => !room.unplaced).map((room) => ({ ...room, label: contractRoomLabel(room.roomNumber) }));
        const unplacedRooms = sorted.filter((room) => room.unplaced).map((room) => ({ ...room, label: contractRoomLabel(room.roomNumber) }));
        return { ...floor, rooms, unplacedRooms };
      }),
  };
}
