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

/** 续签请求体：仅 endDate 必填，其余未提供则从原合同复制（见后端 RenewContractDto） */
export interface RenewContractPayload {
  endDate: string;
  startDate?: string;
  rentAmount?: number;
  depositAmount?: number;
  paymentCycle?: Contract['paymentCycle'];
  paymentDay?: number;
  lateFeeRule?: unknown;
}

/**
 * 合同续签：复制原合同生成 DRAFT 新合同并关联 renewedFromId（T154）。
 * 原合同已续签返回 409，已终止返回 400，新到期日不晚于起始日返回 400。
 */
export const renewContract = (id: string, data: RenewContractPayload) => {
  return request.post(`/contracts/${id}/renew`, data);
};
