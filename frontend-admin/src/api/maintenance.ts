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

export const updateMaintenance = (id: string, data: Partial<Maintenance>) => {
  return request.patch(`/maintenance/${id}`, data);
};

export const deleteMaintenance = (id: string) => {
  return request.delete(`/maintenance/${id}`);
};

export interface MaintenanceAssignee {
  id: string;
  email: string | null;
}

/** 可指派的维修人员（仅 ADMIN） */
export const getMaintenanceAssignees = (): Promise<MaintenanceAssignee[]> => {
  return request.get('/maintenance/assignees');
};
