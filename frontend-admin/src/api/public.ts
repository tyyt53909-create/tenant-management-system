import request from '@/utils/request';

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
