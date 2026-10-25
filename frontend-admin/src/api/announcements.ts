import request from '@/utils/request';

/** 公告受众（COM-04 / T284） */
export type AnnouncementAudience = 'ALL_TENANTS' | 'BUILDING' | 'TAGS' | 'TENANTS';
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: 'NORMAL' | 'URGENT';
  status: AnnouncementStatus;
  audience: AnnouncementAudience;
  targetIds: string[];
  createdBy: string;
  creator?: { id: string; email: string | null };
  publishedAt: string | null;
  expiredAt: string | null;
  recipientCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementPublishResult {
  announcement: Announcement;
  recipients: number;
  failed: number;
  errors: string[];
}

export interface AnnouncementPayload {
  title: string;
  body: string;
  priority?: 'NORMAL' | 'URGENT';
  audience?: AnnouncementAudience;
  targetIds?: string[];
  publish?: boolean;
  expiredAt?: string;
}

export const getAnnouncements = (params: {
  page?: number;
  limit?: number;
  status?: AnnouncementStatus;
  q?: string;
}): Promise<{ data: Announcement[]; meta: { page: number; limit: number; total: number; totalPages: number } }> =>
  request.get('/announcements', { params });

export const getAnnouncement = (id: string): Promise<Announcement> =>
  request.get(`/announcements/${id}`);

export const createAnnouncement = (
  data: AnnouncementPayload,
): Promise<Announcement | AnnouncementPublishResult> => request.post('/announcements', data);

export const updateAnnouncement = (id: string, data: AnnouncementPayload): Promise<Announcement> =>
  request.patch(`/announcements/${id}`, data);

export const publishAnnouncement = (id: string): Promise<AnnouncementPublishResult> =>
  request.post(`/announcements/${id}/publish`);

export const archiveAnnouncement = (id: string): Promise<Announcement> =>
  request.post(`/announcements/${id}/archive`);

export const deleteAnnouncement = (id: string): Promise<{ message: string }> =>
  request.delete(`/announcements/${id}`);
