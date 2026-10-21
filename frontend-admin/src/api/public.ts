import request from '@/utils/request';
import type { SpaceModelContract } from '@/types/space';

/** 公开看房（P1 / T155）：无需登录，后端仅返回可租房源白名单字段 */
export interface PublicRoom {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: 'SINGLE' | 'ONE_BED' | 'TWO_BED' | 'THREE_BED' | 'STUDIO';
  area: number | null;
  facilities: Record<string, unknown> | null;
  description: string | null;
  building: { name: string; address: string | null };
  photos: { fileUrl: string; thumbnail: string | null; sortOrder: number }[];
}

export interface PublicBuilding {
  id: string;
  name: string;
  address: string | null;
}

export const getPublicBuildings = (): Promise<PublicBuilding[]> => {
  return request.get('/public/buildings');
};

/** 公開空間投影；後端只回傳可租房間。 */
export const getPublicBuildingSpace = (buildingId: string): Promise<SpaceModelContract> =>
  request.get(`/public/buildings/${encodeURIComponent(buildingId)}/space`);

export const getPublicRooms = (params: {
  page?: number;
  limit?: number;
  buildingId?: string;
  floor?: number;
  roomType?: string;
}): Promise<{ data: PublicRoom[]; meta: { page: number; limit: number; total: number; totalPages: number } }> => {
  return request.get('/public/rooms', { params });
};

export const getPublicRoomById = (id: string): Promise<PublicRoom> => {
  return request.get(`/public/rooms/${id}`);
};
