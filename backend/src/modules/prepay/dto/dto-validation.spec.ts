import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePrepayTransactionDto } from './create-prepay-transaction.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('CreatePrepayTransactionDto 校验', () => {
  const base = { type: 'RECHARGE', amount: 10000, description: '充值 100 元' };

  it('最小有效请求应通过', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, { ...base });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('带关联字段（relatedId/relatedType）应通过', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, {
      ...base,
      type: 'DEDUCTION',
      relatedId: 'reading-001',
      relatedType: 'METER_READING',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('非整数金额应被拒绝', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, { ...base, amount: 123.45 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'amount')).toBe(true);
  });

  it('非法类型应被拒绝', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, { ...base, type: 'TRANSFER' });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'type')).toBe(true);
  });

  it('空描述应被拒绝', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, { ...base, description: '' });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'description')).toBe(true);
  });

  it('非法关联类型应被拒绝', async () => {
    const dto = plainToInstance(CreatePrepayTransactionDto, {
      ...base,
      relatedType: 'INVOICE',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'relatedType')).toBe(true);
  });
});
