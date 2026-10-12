import request from '@/utils/request';
import type { Meter, PaginatedResponse, QueryParams } from '@/types';

export const getMeters = (params: QueryParams): Promise<PaginatedResponse<Meter>> => {
  return request.get('/meters', { params });
};

export const getMeterById = (id: string): Promise<Meter> => {
  return request.get(`/meters/${id}`);
};

export const createMeter = (data: Partial<Meter>) => {
  return request.post('/meters', data);
};

export const updateMeter = (id: string, data: Partial<Meter>) => {
  return request.patch(`/meters/${id}`, data);
};

export const deleteMeter = (id: string) => {
  return request.delete(`/meters/${id}`);
};
