import request from '@/utils/request';
import type { Bill, LateFee, PaginatedResponse, QueryParams } from '@/types';

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
  /** 同一次逻辑收款的稳定键。超时重试必须沿用，不能每次重生成。 */
  idempotencyKey?: string;
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

// ── 滞纳金（T151）──

export interface LateFeePayload {
  /**
   * 管理者确认金额（单位：分）。
   * - 不传：仅生成 / 刷新系统建议值（不生效、不入账）
   * - 传入：确认入账（可调整，0 表示减免）
   */
  confirmedAmount?: number;
  notes?: string;
}

/** 账单滞纳金记录（含计算过程，管理者可见） */
export const getLateFees = (billId: string): Promise<LateFee[]> => {
  return request.get(`/bills/${billId}/late-fees`);
};

/**
 * 添加 / 确认滞纳金
 * - 不传 confirmedAmount：仅生成或刷新系统建议值（不生效）
 * - 传 confirmedAmount：管理者确认入账（单位：分，可为 0）
 */
export const addLateFee = (billId: string, data: LateFeePayload = {}): Promise<LateFee> => {
  return request.post(`/bills/${billId}/late-fees`, data);
};

// ── 单据识别与匹配 ──

export interface RecognizeVoucherResult {
  success: boolean;
  matchedBy: string;
  billId: string;
  billNumber: string;
  billType: string;
  billTypeLabel: string;
  period: string;
  status: string;
  isPaid: boolean;
  isCancelled: boolean;
  dueDate: string;
  amount: number;
  amountYuan: string;
  paidAmount: number;
  paidAmountYuan: string;
  unpaidAmount: number;
  unpaidAmountYuan: string;
  outstandingLateFees: number;
  outstandingLateFeesYuan: string;
  suggestedAmount: number;
  suggestedAmountYuan: string;
  extractedAmountCents: number | null;
  extractedAmountYuan: string | null;
  amountMatchStatus: 'MATCHED' | 'MISMATCH' | 'UNKNOWN';
  tenant: {
    id: string;
    name: string;
    phone: string;
  };
  room: {
    id: string;
    roomNumber: string;
    buildingName: string;
  };
  recentPayments: Array<{
    id: string;
    amount: number;
    amountYuan: string;
    paymentMethod: string;
    paidAt: string;
  }>;
}

export const recognizeVoucher = (data: { text?: string; code?: string }): Promise<RecognizeVoucherResult> => {
  return request.post('/bills/recognize', data);
};
