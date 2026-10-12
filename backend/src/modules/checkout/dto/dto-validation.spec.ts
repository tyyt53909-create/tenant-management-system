import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryCheckoutsDto } from './query-checkouts.dto.js';
import { UpdateCheckoutDto } from './update-checkout.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

/**
 * 退租状态必须与 Prisma schema / docs/02-数据模型.md 保持一致：
 * DRAFT / PENDING / COMPLETED / CANCELLED
 * 回归测试：防止再次引入 PROCESSING 这类与数据库不一致的值
 */
describe('Checkout DTO 状态校验（回归）', () => {
  it('筛选/更新应接受 PENDING（数据库标准值）', async () => {
    const queryErrors = await validateLikeGlobalPipe(plainToInstance(QueryCheckoutsDto, { status: 'PENDING' }));
    expect(queryErrors).toHaveLength(0);

    const updateErrors = await validateLikeGlobalPipe(plainToInstance(UpdateCheckoutDto, { status: 'PENDING' }));
    expect(updateErrors).toHaveLength(0);
  });

  it('应拒绝 PROCESSING（与数据库不一致的旧值）', async () => {
    const queryErrors = await validateLikeGlobalPipe(
      plainToInstance(QueryCheckoutsDto, { status: 'PROCESSING' }),
    );
    expect(queryErrors.some((error) => error.property === 'status')).toBe(true);

    const updateErrors = await validateLikeGlobalPipe(
      plainToInstance(UpdateCheckoutDto, { status: 'PROCESSING' }),
    );
    expect(updateErrors.some((error) => error.property === 'status')).toBe(true);
  });
});
