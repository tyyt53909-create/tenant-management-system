import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoomDto, RoomType } from './create-room.dto.js';
import { QueryRoomsDto } from './query-rooms.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

/**
 * 楼栋 ID 为 seed 固定值（building-001）或 Prisma cuid，均非 UUID。
 * 回归测试：防止再次引入 UUID 校验导致「通过 API 建房源/筛选房源」必然失败。
 */
describe('Rooms DTO 校验（回归）', () => {
  describe('CreateRoomDto', () => {
    const base = {
      roomNumber: '101',
      floor: 1,
      roomType: RoomType.SINGLE,
    };

    it('应接受 seed 固定楼栋 ID（building-001）', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...base, buildingId: 'building-001' });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    });

    it('应接受 Prisma cuid 格式楼栋 ID', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...base,
        buildingId: 'cmv5bo0jb00011cblwxto7hxu',
      });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    });

    it('应拒绝空楼栋 ID', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...base, buildingId: '' });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors.some((error) => error.property === 'buildingId')).toBe(true);
    });

    it('应拒绝缺失楼栋 ID', async () => {
      const dto = plainToInstance(CreateRoomDto, { ...base });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors.some((error) => error.property === 'buildingId')).toBe(true);
    });

    it('楼层为负数应被拒绝（顺带覆盖既有规则）', async () => {
      const dto = plainToInstance(CreateRoomDto, {
        ...base,
        buildingId: 'building-001',
        floor: -1,
      });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors.some((error) => error.property === 'floor')).toBe(true);
    });
  });

  describe('QueryRoomsDto', () => {
    it('应接受非 UUID 楼栋筛选（building-001）', async () => {
      const dto = plainToInstance(QueryRoomsDto, { buildingId: 'building-001' });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    });

    it('应接受 cuid 楼栋筛选', async () => {
      const dto = plainToInstance(QueryRoomsDto, { buildingId: 'cmv5bo0jb00011cblwxto7hxu' });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    });

    it('未传筛选条件时应全部可选（默认分页值）', async () => {
      const dto = plainToInstance(QueryRoomsDto, {});

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    });
  });
});
