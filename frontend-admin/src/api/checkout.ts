import request from '@/utils/request';
import type { CheckoutPayload, CheckoutRecord, PaginatedResponse, QueryParams } from '@/types';

export const getCheckoutRecords = (params: QueryParams): Promise<PaginatedResponse<CheckoutRecord>> => {
  return request.get('/checkout', { params });
};

/** 退租记录详情：返回结果包含结算明细 items（金额单位为分） */
export const getCheckoutById = (id: string): Promise<CheckoutRecord> => {
  return request.get(`/checkout/${id}`);
};

/**
 * 新增退租记录。
 *
 * 结算明细通过 data.items 原样透传给后端（POST /checkout）：
 * 每项 { itemType, description, amount } 中 amount 单位为「分」，
 * 后端要求 items 一旦提供则至少 1 项，且每项类别合法、说明非空、金额为非负整数。
 */
export const createCheckout = (data: CheckoutPayload): Promise<CheckoutRecord> => {
  return request.post('/checkout', data);
};

/**
 * 更新退租记录（PATCH /checkout/:id）。
 * items 同样透传；状态字段仅后端更新接口接受（新增接口不接受 status）。
 */
export const updateCheckout = (id: string, data: Partial<CheckoutPayload>): Promise<CheckoutRecord> => {
  return request.patch(`/checkout/${id}`, data);
};

export const deleteCheckout = (id: string) => {
  return request.delete(`/checkout/${id}`);
};
