import request from '@/utils/request';
import type { CheckoutRecord, PaginatedResponse, QueryParams } from '@/types';

export const getCheckoutRecords = (params: QueryParams): Promise<PaginatedResponse<CheckoutRecord>> => {
  return request.get('/checkout', { params });
};

export const getCheckoutById = (id: string): Promise<CheckoutRecord> => {
  return request.get(`/checkout/${id}`);
};

export const createCheckout = (data: Partial<CheckoutRecord>) => {
  return request.post('/checkout', data);
};

export const updateCheckout = (id: string, data: Partial<CheckoutRecord>) => {
  return request.patch(`/checkout/${id}`, data);
};

export const deleteCheckout = (id: string) => {
  return request.delete(`/checkout/${id}`);
};
