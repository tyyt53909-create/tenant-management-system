import request from '@/utils/request';
import type { Notification, QueryParams } from '@/types';

/** GET /notifications 的 meta：通用分页字段 + 当前用户未读总数 */
export interface NotificationListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export interface NotificationListResponse {
  data: Notification[];
  meta: NotificationListMeta;
}

/**
 * 通知列表（分页，按 createdAt 倒序）
 *
 * ⚠️ 后端 QueryNotificationsDto.unreadOnly 为 `@IsBoolean() @Type(() => Boolean)`，
 * 查询串里的 `unreadOnly=false` 会被布尔化成正数真值（Boolean('false') === true），
 * 因此关闭筛选时必须**省略**该参数，不能传 false。
 */
export const getNotifications = (params: QueryParams): Promise<NotificationListResponse> => {
  return request.get('/notifications', { params });
};

/** 未读数（GET /notifications/unread-count） */
export const getUnreadCount = (): Promise<{ unreadCount: number }> => {
  return request.get('/notifications/unread-count');
};

/** 单条标记已读（PATCH /notifications/:id/read） */
export const markNotificationRead = (id: string): Promise<Notification> => {
  return request.patch(`/notifications/${id}/read`);
};

/** 全部标记已读（PATCH /notifications/read-all），返回本次影响条数 */
export const markAllNotificationsRead = (): Promise<{ message: string; count: number }> => {
  return request.patch('/notifications/read-all');
};

/** 删除通知（DELETE /notifications/:id） */
export const deleteNotification = (id: string): Promise<{ message: string }> => {
  return request.delete(`/notifications/${id}`);
};
