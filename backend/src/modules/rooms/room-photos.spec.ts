import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { bindPhotoAssets, buildRoomPhotoRows, collectPhotoKeys, photoKey } from './room-photos.js';

describe('房源照片规则（T288 抽取自 rooms.service）', () => {
  describe('photoKey', () => {
    it('接受本站上传接口的地址（含 public 前缀）', () => {
      expect(photoKey('/api/files/a.png')).toBe('a.png');
      expect(photoKey('/api/public/files/b_1-thumb.jpg')).toBe('b_1-thumb.jpg');
    });

    it('拒绝站外地址、路径穿越与查询串', () => {
      for (const url of [
        'https://evil.example.com/a.png',
        '/api/files/../secret.png',
        '/api/files/a.png?x=1',
        'files/a.png',
        '',
      ]) {
        expect(() => photoKey(url), url).toThrow(BadRequestException);
      }
    });
  });

  it('collectPhotoKeys 去重并保留首次出现顺序', () => {
    expect(
      collectPhotoKeys([
        { fileUrl: '/api/files/a.png', thumbnail: '/api/files/a-thumb.jpg' } as never,
        { fileUrl: '/api/files/a.png' } as never,
        { fileUrl: '/api/files/b.png', thumbnail: '/api/files/a-thumb.jpg' } as never,
      ]),
    ).toEqual(['a.png', 'a-thumb.jpg', 'b.png']);
  });

  it('buildRoomPhotoRows 以数组顺序写 sortOrder，首张为封面', () => {
    const rows = buildRoomPhotoRows([
      { fileUrl: '/api/files/a.png', thumbnail: '/api/files/a-thumb.jpg', fileSize: 100 } as never,
      { fileUrl: '/api/files/b.png' } as never,
    ]);
    expect(rows).toEqual([
      { fileUrl: '/api/files/a.png', thumbnail: '/api/files/a-thumb.jpg', fileSize: 100, sortOrder: 0 },
      { fileUrl: '/api/files/b.png', thumbnail: null, fileSize: 0, sortOrder: 1 },
    ]);
  });

  it('超过 20 张抛 400 并写明上限', () => {
    const photos = Array.from({ length: 21 }, (_, index) => ({
      fileUrl: `/api/files/${index}.png`,
    })) as never;
    expect(() => buildRoomPhotoRows(photos)).toThrow(/最多 20 张/);
  });

  it('空照片不查库', async () => {
    const db = { fileAsset: { findMany: vi.fn(), updateMany: vi.fn() } };
    await bindPhotoAssets(db as never, [], 'room-1');
    expect(db.fileAsset.findMany).not.toHaveBeenCalled();
  });

  it('资产未登记时拒绝，错误里带出缺失的 key', async () => {
    const db = {
      fileAsset: {
        findMany: vi.fn().mockResolvedValue([{ key: 'a.png' }]),
        updateMany: vi.fn(),
      },
    };
    await expect(
      bindPhotoAssets(db as never, [{ fileUrl: '/api/files/a.png' }, { fileUrl: '/api/files/b.png' }] as never, 'room-1'),
    ).rejects.toThrow(/b\.png/);
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
  });

  it('资产齐全时绑定为公开房源照片', async () => {
    const db = {
      fileAsset: {
        findMany: vi.fn().mockResolvedValue([{ key: 'a.png' }, { key: 'a-thumb.jpg' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    await bindPhotoAssets(
      db as never,
      [{ fileUrl: '/api/files/a.png', thumbnail: '/api/files/a-thumb.jpg' }] as never,
      'room-9',
    );
    expect(db.fileAsset.updateMany).toHaveBeenCalledWith({
      where: { key: { in: ['a.png', 'a-thumb.jpg'] } },
      data: {
        purpose: 'ROOM_PHOTO',
        visibility: 'PUBLIC',
        ownerType: 'ROOM',
        ownerId: 'room-9',
      },
    });
  });
});
