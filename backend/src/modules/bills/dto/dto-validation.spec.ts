import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBillDto } from './create-bill.dto.js';
import { UpdateBillDto } from './update-bill.dto.js';
import { CreatePaymentDto } from './create-payment.dto.js';
import { CreateLateFeeDto } from './create-late-fee.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

/**
 * 回归测试：snapshot（JSON 透传字段）此前没有校验装饰器，
 * 在 forbidNonWhitelisted 下会导致「不带 snapshot 的请求也 400：property snapshot should not exist」
 */
describe('Bill DTO 校验（回归）', () => {
  const base = {
    contractId: 'contract-001',
    billType: 'RENT',
    period: '2026-10',
    amount: 100000,
    dueDate: '2026-10-05',
  };

  it('不带 snapshot 的创建请求应通过', async () => {
    const dto = plainToInstance(CreateBillDto, { ...base });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('带 snapshot 的创建请求应通过', async () => {
    const dto = plainToInstance(CreateBillDto, {
      ...base,
      snapshot: { rentAmount: 100000 },
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('更新请求（status/paidAmount）应通过', async () => {
    const dto = plainToInstance(UpdateBillDto, { status: 'PAID', paidAmount: 100000 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('CreatePaymentDto 校验（收款登记）', () => {
  const base = { amount: 40000, paymentMethod: 'CASH' };

  it('最小有效请求（金额+方式）应通过', async () => {
    const dto = plainToInstance(CreatePaymentDto, { ...base });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('完整字段（交易号/收款时间/备注）应通过', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      ...base,
      transactionNumber: 'TXN-001',
      paidAt: '2026-10-12T10:00:00.000Z',
      notes: '现金收款',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('金额为 0 或负数应被拒绝', async () => {
    for (const amount of [0, -100]) {
      const dto = plainToInstance(CreatePaymentDto, { ...base, amount });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors.some((error) => error.property === 'amount')).toBe(true);
    }
  });

  it('非整数金额应被拒绝', async () => {
    const dto = plainToInstance(CreatePaymentDto, { ...base, amount: 123.45 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'amount')).toBe(true);
  });

  it('非法收款方式应被拒绝', async () => {
    const dto = plainToInstance(CreatePaymentDto, { ...base, paymentMethod: 'BITCOIN' });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'paymentMethod')).toBe(true);
  });

  it('非法收款时间应被拒绝', async () => {
    const dto = plainToInstance(CreatePaymentDto, { ...base, paidAt: 'not-a-date' });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'paidAt')).toBe(true);
  });
});

describe('CreateLateFeeDto 校验（滞纳金）', () => {
  it('空请求（仅生成建议值）应通过', async () => {
    const dto = plainToInstance(CreateLateFeeDto, {});

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('确认金额 + 备注应通过', async () => {
    const dto = plainToInstance(CreateLateFeeDto, { confirmedAmount: 4200, notes: '协商减免' });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('确认金额为 0（减免）应通过', async () => {
    const dto = plainToInstance(CreateLateFeeDto, { confirmedAmount: 0 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('负数确认金额应被拒绝', async () => {
    const dto = plainToInstance(CreateLateFeeDto, { confirmedAmount: -1 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'confirmedAmount')).toBe(true);
  });

  it('非整数确认金额应被拒绝', async () => {
    const dto = plainToInstance(CreateLateFeeDto, { confirmedAmount: 12.5 });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors.some((error) => error.property === 'confirmedAmount')).toBe(true);
  });
});
