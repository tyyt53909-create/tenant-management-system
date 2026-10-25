import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAX_ROOM_PHOTOS, type RoomPhotoDto } from './dto/room-photo.dto.js';

/**
 * 房源照片落库规则（QLT-02 / T288：从 603 行的 `rooms.service.ts` 抽出）。
 *
 * 三个动作原本是 RoomsService 的私有方法，只能通过 46 个 HTTP 级用例间接验证：
 * 1. `photoKey`：只接受本站上传接口返回的 URL，拒绝站外/客户端拼接地址；
 * 2. `buildRoomPhotoRows`：校验张数上限并生成 sortOrder（数组顺序即展示顺序，首张封面）；
 * 3. `bindPhotoAssets`：确认文件资产确实由上传接口登记过，再绑定用途与归属。
 */

const FILE_URL_PATTERN = /^\/api\/(?:public\/)?files\/([A-Za-z0-9._-]+)$/;

/** 从站内 URL 提取对象键；非上传地址直接拒绝（ISS-06 回归）。 */
export function photoKey(url: string): string {
  const match = FILE_URL_PATTERN.exec(url);
  if (!match) {
    throw new BadRequestException('照片地址必须来自文件上传接口');
  }
  return match[1];
}

/** 收集主图与缩略图的全部 key，去重后保持首次出现顺序。 */
export function collectPhotoKeys(photos: RoomPhotoDto[]): string[] {
  return [
    ...new Set(
      photos.flatMap((photo) => [
        photoKey(photo.fileUrl),
        ...(photo.thumbnail ? [photoKey(photo.thumbnail)] : []),
      ]),
    ),
  ];
}

/** 校验张数上限并生成落库字段；数组顺序即 sortOrder，第一张为封面。 */
export function buildRoomPhotoRows(photos: RoomPhotoDto[]) {
  if (photos.length > MAX_ROOM_PHOTOS) {
    throw new BadRequestException(`房源照片最多 ${MAX_ROOM_PHOTOS} 张`);
  }
  return photos.map((photo, index) => ({
    fileUrl: photo.fileUrl,
    thumbnail: photo.thumbnail ?? null,
    fileSize: photo.fileSize ?? 0,
    sortOrder: index,
  }));
}

/**
 * 校验照片资产存在，并绑定为 ROOM_PHOTO / PUBLIC / owner=ROOM。
 *
 * 必须在事务内调用：资产绑定与房源创建要么一起成功，要么一起回滚，
 * 否则会出现「房源没建成，但照片已被标记为公开」的越权窗口。
 */
export async function bindPhotoAssets(
  db: Prisma.TransactionClient | PrismaService,
  photos: RoomPhotoDto[],
  roomId: string,
): Promise<void> {
  const keys = collectPhotoKeys(photos);
  if (keys.length === 0) return;

  const assets = await db.fileAsset.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  });
  const found = new Set(assets.map((asset) => asset.key));
  const missing = keys.filter((key) => !found.has(key));
  if (missing.length > 0) {
    throw new BadRequestException(`照片未通过文件上传接口登记：${missing[0]}`);
  }

  await db.fileAsset.updateMany({
    where: { key: { in: keys } },
    data: {
      purpose: 'ROOM_PHOTO',
      visibility: 'PUBLIC',
      ownerType: 'ROOM',
      ownerId: roomId,
    },
  });
}
