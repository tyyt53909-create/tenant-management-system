import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';
import { QueryBuildingsDto } from './query-buildings.dto.js';

/**
 * 回归 T209：原先用 `@Type(() => Boolean)`，class-transformer 会把字符串 "false"
 * 转成 true —— `GET /buildings?isActive=false` 反而只返回「启用中」的楼栋。
 */
describe('QueryBuildingsDto 布尔转换', () => {
  it('isActive=false → false（不是 true）', () => {
    expect(plainToInstance(QueryBuildingsDto, { isActive: 'false' }).isActive).toBe(false);
  });

  it('isActive=true → true', () => {
    expect(plainToInstance(QueryBuildingsDto, { isActive: 'true' }).isActive).toBe(true);
  });

  it('不传 isActive 时保持 undefined（不加筛选）', () => {
    expect(plainToInstance(QueryBuildingsDto, {}).isActive).toBeUndefined();
  });
});
