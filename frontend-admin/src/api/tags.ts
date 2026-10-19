import request from '@/utils/request';

/** 标签字典条目（T215） */
export interface Tag {
  id: string;
  name: string;
  sort: number;
  createdAt: string;
  /** 已分配该标签的租客数 */
  tenantCount?: number;
}

export const getTags = (): Promise<Tag[]> => request.get('/tags');

export const createTag = (data: { name: string; sort?: number }): Promise<Tag> =>
  request.post('/tags', data);

export const updateTag = (id: string, data: { name?: string; sort?: number }): Promise<Tag> =>
  request.patch(`/tags/${id}`, data);

export const deleteTag = (id: string): Promise<{ message: string; affectedTenants: number }> =>
  request.delete(`/tags/${id}`);
