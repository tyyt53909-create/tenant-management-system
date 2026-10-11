import request from '@/utils/request';
import type { Tenant, PaginatedResponse, QueryParams } from '@/types';

// 获取租客列表
export const getTenants = (params: QueryParams): Promise<PaginatedResponse<Tenant>> => {
  return request.get('/tenants', { params });
};

// 获取租客详情
export const getTenantById = (id: string): Promise<Tenant> => {
  return request.get(`/tenants/${id}`);
};

// 创建租客
export const createTenant = (data: Partial<Tenant>) => {
  return request.post('/tenants', data);
};

// 更新租客
export const updateTenant = (id: string, data: Partial<Tenant>) => {
  return request.patch(`/tenants/${id}`, data);
};

// 删除租客
export const deleteTenant = (id: string) => {
  return request.delete(`/tenants/${id}`);
};
