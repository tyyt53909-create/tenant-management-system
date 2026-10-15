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

export interface TenantAccountResponse {
  status: 'REGISTERED' | 'UNREGISTERED';
  userId?: string;
  email?: string;
  phone?: string;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface TenantCapabilityItem {
  code: string;
  name: string;
  description: string;
  group: 'contract' | 'bill' | 'prepay' | 'maintenance' | 'checkout';
  defaultEffect: 'ALLOW';
}

export interface TenantCapabilityOverride {
  capability: string;
  effect: 'ALLOW' | 'DENY';
  reason?: string | null;
  grantedBy?: string;
  updatedAt?: string;
}

export interface TenantCapabilitiesResponse {
  status: 'REGISTERED' | 'UNREGISTERED';
  userId?: string;
  catalog: TenantCapabilityItem[];
  overrides: TenantCapabilityOverride[];
  effectiveCapabilities: string[];
}

// 获取租客账号状态
export const getTenantAccount = (id: string): Promise<TenantAccountResponse> => {
  return request.get(`/tenants/${id}/account`);
};

// 修改租客账号登录状态（禁用 / 启用登录）
export const updateTenantAccount = (id: string, data: { isActive: boolean }): Promise<{ success: boolean; isActive: boolean }> => {
  return request.patch(`/tenants/${id}/account`, data);
};

// 获取租客功能能力清单与生效覆盖
export const getTenantCapabilities = (id: string): Promise<TenantCapabilitiesResponse> => {
  return request.get(`/tenants/${id}/capabilities`);
};

// 整批替换租客能力的 DENY 屏蔽项
export const updateTenantCapabilities = (
  id: string,
  data: { denied: string[]; reasons?: Record<string, string> },
): Promise<TenantCapabilitiesResponse> => {
  return request.put(`/tenants/${id}/capabilities`, data);
};
