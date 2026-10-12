import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBillDto } from './create-bill.dto.js';
import { UpdateBillDto } from './update-bill.dto.js';

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
