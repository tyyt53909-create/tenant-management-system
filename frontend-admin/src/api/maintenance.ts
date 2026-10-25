import request from '@/utils/request';
import type { Maintenance, PaginatedResponse, QueryParams } from '@/types';

export const getMaintenanceList = (params: QueryParams): Promise<PaginatedResponse<Maintenance>> => {
  return request.get('/maintenance', { params });
};

export const getMaintenanceById = (id: string): Promise<Maintenance> => {
  return request.get(`/maintenance/${id}`);
};

export const createMaintenance = (data: Partial<Maintenance>) => {
  return request.post('/maintenance', data);
};

export interface MaintenanceMessage {
  id: string;
  requestId: string;
  type: 'MESSAGE' | 'SYSTEM';
  authorId: string | null;
  authorRole: string | null;
  body: string;
  createdAt: string;
}

export const getMaintenanceMessages = (id: string): Promise<{ data: MaintenanceMessage[] }> => {
  return request.get(`/maintenance/${id}/messages`);
};

export const addMaintenanceMessage = (id: string, body: string): Promise<MaintenanceMessage> => {
  return request.post(`/maintenance/${id}/messages`, { body });
};

export const updateMaintenance = (id: string, data: Partial<Maintenance>) => {
  return request.patch(`/maintenance/${id}`, data);
};

export const deleteMaintenance = (id: string) => {
  return request.delete(`/maintenance/${id}`);
};
