import type { CleanStatus, RoomStatus } from '@/types';

/** Element Plus el-tag 支持的类型 */
export type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger';

/** 房态中文标签（与后端 RoomStatus 一致） */
export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  VACANT: '空置',
  OCCUPIED: '已租',
  MAINTENANCE: '维护中',
  RESERVED: '已预订',
};

/** 房态颜色区分 */
export const ROOM_STATUS_TAG_TYPES: Record<RoomStatus, TagType> = {
  VACANT: 'success',
  OCCUPIED: 'warning',
  MAINTENANCE: 'danger',
  RESERVED: 'info',
};

export const ROOM_STATUS_OPTIONS: { label: string; value: RoomStatus }[] = [
  { label: '空置', value: 'VACANT' },
  { label: '已租', value: 'OCCUPIED' },
  { label: '维护中', value: 'MAINTENANCE' },
  { label: '已预订', value: 'RESERVED' },
];

/** 清洁状态中文标签（cleanStatus：CLEAN / PENDING_CLEAN / CLEANING） */
export const CLEAN_STATUS_LABELS: Record<CleanStatus, string> = {
  CLEAN: '已清洁',
  PENDING_CLEAN: '待清洁',
  CLEANING: '清洁中',
};

/** 清洁状态颜色区分：已清洁=绿、待清洁=橙、清洁中=蓝 */
export const CLEAN_STATUS_TAG_TYPES: Record<CleanStatus, TagType> = {
  CLEAN: 'success',
  PENDING_CLEAN: 'warning',
  CLEANING: 'primary',
};

export const CLEAN_STATUS_OPTIONS: { label: string; value: CleanStatus }[] = [
  { label: '已清洁', value: 'CLEAN' },
  { label: '待清洁', value: 'PENDING_CLEAN' },
  { label: '清洁中', value: 'CLEANING' },
];

/** 需要保洁介入的状态（待清洁 + 清洁中） */
export const NEEDS_CLEANING_STATUSES: CleanStatus[] = ['PENDING_CLEAN', 'CLEANING'];

export const isCleanStatus = (value: unknown): value is CleanStatus =>
  value === 'CLEAN' || value === 'PENDING_CLEAN' || value === 'CLEANING';

export const isRoomStatus = (value: unknown): value is RoomStatus =>
  value === 'VACANT' || value === 'OCCUPIED' || value === 'MAINTENANCE' || value === 'RESERVED';

export const cleanStatusLabel = (value?: string): string =>
  isCleanStatus(value) ? CLEAN_STATUS_LABELS[value] : '未知';

export const cleanStatusTagType = (value?: string): TagType =>
  isCleanStatus(value) ? CLEAN_STATUS_TAG_TYPES[value] : 'info';

export const roomStatusLabel = (value?: string): string =>
  isRoomStatus(value) ? ROOM_STATUS_LABELS[value] : '未知';

export const roomStatusTagType = (value?: string): TagType =>
  isRoomStatus(value) ? ROOM_STATUS_TAG_TYPES[value] : 'info';

/** 是否处于需要保洁介入的状态 */
export const needsCleaning = (value?: string): boolean => needsCleaningStatus(value);

function needsCleaningStatus(value?: string): boolean {
  return !!value && (NEEDS_CLEANING_STATUSES as string[]).includes(value);
}
