import { describe, expect, it } from 'vitest';
import {
  MAX_ROOM_PHOTO_SIZE,
  moveRoomPhoto,
  removeRoomPhotoAt,
  toRoomPhotoPayload,
  validateRoomPhotoFile,
} from './roomPhotos';
import type { RoomPhoto } from '@/types';

const photos: RoomPhoto[] = [
  { id: 'photo-1', fileUrl: '/api/files/cover.jpg', thumbnail: '/api/files/cover.thumb.jpg', fileSize: 2048, sortOrder: 0 },
  { id: 'photo-2', fileUrl: '/api/files/second.png', fileSize: 1024, sortOrder: 1 },
  { id: 'photo-3', fileUrl: '/api/files/third.webp', fileSize: 512, sortOrder: 2 },
];

describe('roomPhotos', () => {
  it('接受 JPG / PNG / WebP', () => {
    expect(validateRoomPhotoFile({ type: 'image/jpeg', size: 1024 })).toBeNull();
    expect(validateRoomPhotoFile({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateRoomPhotoFile({ type: 'image/webp', size: 1024 })).toBeNull();
  });

  it('拒绝 GIF 与超过 10MB 的图片', () => {
    expect(validateRoomPhotoFile({ type: 'image/gif', size: 1024 })).toContain('JPG');
    expect(validateRoomPhotoFile({ type: 'image/jpeg', size: MAX_ROOM_PHOTO_SIZE + 1 })).toContain('10MB');
  });

  it('移动照片不修改原数组，并保持顺序', () => {
    const moved = moveRoomPhoto(photos, 2, 0);
    expect(moved.map((photo) => photo.fileUrl)).toEqual([
      '/api/files/third.webp',
      '/api/files/cover.jpg',
      '/api/files/second.png',
    ]);
    expect(photos.map((photo) => photo.fileUrl)).toEqual([
      '/api/files/cover.jpg',
      '/api/files/second.png',
      '/api/files/third.webp',
    ]);
  });

  it('越界移动返回原数组', () => {
    expect(moveRoomPhoto(photos, 0, 9)).toBe(photos);
    expect(moveRoomPhoto(photos, -1, 0)).toBe(photos);
  });

  it('删除指定照片不修改原数组', () => {
    const removed = removeRoomPhotoAt(photos, 1);
    expect(removed.map((photo) => photo.fileUrl)).toEqual([
      '/api/files/cover.jpg',
      '/api/files/third.webp',
    ]);
    expect(photos).toHaveLength(3);
  });

  it('提交时只保留后端 DTO 字段，顺序即封面顺序', () => {
    expect(toRoomPhotoPayload(photos)).toEqual([
      {
        fileUrl: '/api/files/cover.jpg',
        thumbnail: '/api/files/cover.thumb.jpg',
        fileSize: 2048,
      },
      { fileUrl: '/api/files/second.png', fileSize: 1024 },
      { fileUrl: '/api/files/third.webp', fileSize: 512 },
    ]);
  });

  it('缺少 fileSize 时按 0 提交', () => {
    expect(toRoomPhotoPayload([{ fileUrl: '/api/files/a.jpg' }])).toEqual([
      { fileUrl: '/api/files/a.jpg', fileSize: 0 },
    ]);
  });
});
