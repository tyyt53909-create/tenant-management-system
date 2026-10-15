import request from '@/utils/request';
import type { Building, PaginatedResponse, QueryParams } from '@/types';

export const getBuildings = (params: QueryParams): Promise<PaginatedResponse<Building>> => {
  return request.get('/buildings', { params });
};

export const getBuildingById = (id: string): Promise<Building> => {
  return request.get(`/buildings/${id}`);
};

export const createBuilding = (data: Partial<Building>) => {
  return request.post('/buildings', data);
};

export const updateBuilding = (id: string, data: Partial<Building>) => {
  return request.patch(`/buildings/${id}`, data);
};

export const deleteBuilding = (id: string) => {
  return request.delete(`/buildings/${id}`);
};
