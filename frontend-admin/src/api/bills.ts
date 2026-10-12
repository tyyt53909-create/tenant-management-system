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

// ── 收款登记（T135）──

export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'WECHAT' | 'ALIPAY' | 'OTHER';

export interface PaymentPayload {
  /** 收款金额（单位：分） */
  amount: number;
  paymentMethod: PaymentMethod;
  /** 交易号（同一账单内幂等） */
  transactionNumber?: string;
  /** 收款时间（ISO 字符串，缺省为当前时间） */
  paidAt?: string;
  notes?: string;
}

export interface PaymentRecordItem {
  id: string;
  billId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  transactionNumber: string | null;
  paidAt: string;
  confirmedBy: string;
  notes: string | null;
  createdAt: string;
}

export interface AddPaymentResult {
  payment: PaymentRecordItem;
  bill: Bill;
}

/** 登记收款 */
export const addPayment = (billId: string, data: PaymentPayload): Promise<AddPaymentResult> => {
  return request.post(`/bills/${billId}/payments`, data);
};

/** 账单收款流水 */
export const getPayments = (billId: string): Promise<PaymentRecordItem[]> => {
  return request.get(`/bills/${billId}/payments`);
};
