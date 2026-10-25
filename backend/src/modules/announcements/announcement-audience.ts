import type { AnnouncementAudience } from '@prisma/client';

export interface AudienceTarget {
  audience: AnnouncementAudience;
  targetIds: string[];
}

/**
 * 公告目标校验（COM-04 / T284）。
 *
 * - ALL_TENANTS 不需要目标 ID；传了也不报错，直接忽略，避免前端残留旧值导致发布失败。
 * - 其余三种目标必须至少一个 ID，否则会「悄悄发给零个人」，这里直接拒绝。
 */
export function validateAudience({ audience, targetIds }: AudienceTarget): string[] {
  const ids = Array.from(new Set((targetIds ?? []).map((id) => id?.trim()).filter(Boolean)));
  if (audience === 'ALL_TENANTS') return [];
  if (ids.length === 0) {
    throw new Error(`公告目标 ${audience} 必须至少指定一个 ID`);
  }
  return ids;
}

/** 通知去重键：同一公告对同一用户只投递一次（重发保持幂等）。 */
export function announcementDedupKey(announcementId: string, userId: string): string {
  return `ANNOUNCEMENT:${announcementId}:${userId}`;
}
