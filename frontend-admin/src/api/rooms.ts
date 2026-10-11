import request from '@/utils/request';
import type { Room, PaginatedResponse, QueryParams } from '@/types';

// 获取房源列表
export const getRooms = (params: QueryParams): Promise<PaginatedResponse<Room>> => {
  return request.get('/rooms', { params });
};

// 获取房源详情
export const getRoomById = (id: string): Promise<Room> => {
  return request.get(`/rooms/${id}`);
};

// 创建房源
export const createRoom = (data: Partial<Room>) => {
  return request.post('/rooms', data);
};

// 更新房源
export const updateRoom = (id: string, data: Partial<Room>) => {
  return request.patch(`/rooms/${id}`, data);
};

// 删除房源
export const deleteRoom = (id: string) => {
  return request.delete(`/rooms/${id}`);
};
