import request from '@/utils/request';
import type { Contract, PaginatedResponse, QueryParams } from '@/types';

export const getContracts = (params: QueryParams): Promise<PaginatedResponse<Contract>> => {
  return request.get('/contracts', { params });
};

export const getContractById = (id: string): Promise<Contract> => {
  return request.get(`/contracts/${id}`);
};

export const createContract = (data: Partial<Contract>) => {
  return request.post('/contracts', data);
};

export const updateContract = (id: string, data: Partial<Contract>) => {
  return request.patch(`/contracts/${id}`, data);
};

export const deleteContract = (id: string) => {
  return request.delete(`/contracts/${id}`);
};
