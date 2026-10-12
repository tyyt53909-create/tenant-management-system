import request from '@/utils/request';
import type { Bill, PaginatedResponse, QueryParams } from '@/types';

export const getBills = (params: QueryParams): Promise<PaginatedResponse<Bill>> => {
  return request.get('/bills', { params });
};

export const getBillById = (id: string): Promise<Bill> => {
  return request.get(`/bills/${id}`);
};

export const createBill = (data: Partial<Bill>) => {
  return request.post('/bills', data);
};

export const updateBill = (id: string, data: Partial<Bill>) => {
  return request.patch(`/bills/${id}`, data);
};

export const deleteBill = (id: string) => {
  return request.delete(`/bills/${id}`);
};
