import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateMeterReadingDto } from './create-meter-reading.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('CreateMeterReadingDto 校验', () => {
  it('最小有效请求（仅当前读数）应通过', async () => {
    const dto = plainToInstance(CreateMeterReadingDto, { currentReading: 123.45 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('完整字段（读数时间/备注）应通过', async () => {
    const dto = plainToInstance(CreateMeterReadingDto, {
      currentReading: 100,
      readingTime: '2026-10-12T10:00:00.000Z',
      notes: '例行抄表',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('负数读数应被拒绝', async () => {
    const dto = plainToInstance(CreateMeterReadingDto, { currentReading: -1 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'currentReading')).toBe(true);
  });

  it('超过两位小数的读数应被拒绝', async () => {
    const dto = plainToInstance(CreateMeterReadingDto, { currentReading: 1.234 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'currentReading')).toBe(true);
  });

  it('非法读数时间应被拒绝', async () => {
    const dto = plainToInstance(CreateMeterReadingDto, {
      currentReading: 100,
      readingTime: 'not-a-date',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'readingTime')).toBe(true);
  });
});
