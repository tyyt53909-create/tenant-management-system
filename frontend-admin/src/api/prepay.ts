import request from '@/utils/request';
import type { PaginatedResponse, QueryParams } from '@/types';

export interface PrepayAccount {
  id: string;
  tenantId: string;
  roomId: string;
  balanceCache: number;
  lowBalanceThreshold: number;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tenant?: { name: string; phone?: string | null };
  roomNumber?: string | null;
}

export type PrepayTransactionType = 'RECHARGE' | 'DEDUCTION' | 'REFUND' | 'ADJUSTMENT';
export type RelatedType = 'METER_READING' | 'CHECKOUT' | 'MANUAL_ADJUSTMENT';

export interface PrepayTransaction {
  id: string;
  accountId: string;
  type: PrepayTransactionType;
  /** 金额（分）：正数为增加，负数为减少 */
  amount: number;
  balanceAfter: number;
  relatedId: string | null;
  relatedType: RelatedType | null;
  description: string;
  operatorId: string;
  createdAt: string;
}

export interface PrepayTransactionPayload {
  type: PrepayTransactionType;
  /** RECHARGE/DEDUCTION/REFUND 必须为正数；ADJUSTMENT 可正可负（不可为 0） */
  amount: number;
  description: string;
  relatedId?: string;
  relatedType?: RelatedType;
}

export const getPrepayAccounts = (params: QueryParams): Promise<PaginatedResponse<PrepayAccount>> => {
  return request.get('/prepay-accounts', { params });
};

export const createPrepayAccount = (data: {
  tenantId: string;
  roomId: string;
  lowBalanceThreshold?: number;
}) => {
  return request.post('/prepay-accounts', data);
};

export const updatePrepayAccount = (id: string, data: { lowBalanceThreshold?: number }) => {
  return request.patch(`/prepay-accounts/${id}`, data);
};

export const deletePrepayAccount = (id: string) => {
  return request.delete(`/prepay-accounts/${id}`);
};

/** 登记充值/扣费/退款/调整 */
export const addPrepayTransaction = (accountId: string, data: PrepayTransactionPayload) => {
  return request.post(`/prepay-accounts/${accountId}/transactions`, data);
};

/** 账户流水（分页倒序） */
export const getPrepayTransactions = (
  accountId: string,
  params?: QueryParams
): Promise<PaginatedResponse<PrepayTransaction>> => {
  return request.get(`/prepay-accounts/${accountId}/transactions`, { params });
};
