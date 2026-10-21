import type { RoomPhoto } from '@/types';

/** 与后端 `MAX_ROOM_PHOTOS` 保持一致。 */
export const MAX_ROOM_PHOTOS = 20;
/** 与文件上传接口上限一致。 */
export const MAX_ROOM_PHOTO_SIZE = 10 * 1024 * 1024;
export const ROOM_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 返回用户可读的错误文案；`null` 表示通过。 */
export function validateRoomPhotoFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_TYPES.has(file.type)) return '仅支持 JPG / PNG / WebP 图片';
  if (file.size > MAX_ROOM_PHOTO_SIZE) return '单张照片不能超过 10MB';
  return null;
}

/** 上移/下移，返回新数组，不修改入参。 */
export function moveRoomPhoto(photos: RoomPhoto[], from: number, to: number): RoomPhoto[] {
  if (from < 0 || from >= photos.length || to < 0 || to >= photos.length || from === to) {
    return photos;
  }
  const next = [...photos];
  const [photo] = next.splice(from, 1);
  next.splice(to, 0, photo!);
  return next;
}

export function removeRoomPhotoAt(photos: RoomPhoto[], index: number): RoomPhoto[] {
  if (index < 0 || index >= photos.length) return photos;
  return photos.filter((_, current) => current !== index);
}

/**
 * 只提交后端 DTO 声明的字段（`fileUrl` / `thumbnail` / `fileSize`），
 * 顺序即 sortOrder；第一张为封面。`id`、`sortOrder` 等本地字段不发送，
 * 避免全局 `forbidNonWhitelisted` 返回 400。
 */
export function toRoomPhotoPayload(photos: RoomPhoto[]) {
  return photos.map((photo) => ({
    fileUrl: photo.fileUrl,
    ...(photo.thumbnail ? { thumbnail: photo.thumbnail } : {}),
    fileSize: photo.fileSize ?? 0,
  }));
}
