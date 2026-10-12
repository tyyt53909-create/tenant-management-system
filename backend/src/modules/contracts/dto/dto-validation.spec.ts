import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateContractDto } from './create-contract.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

/**
 * 付款周期枚举必须与 Prisma schema / docs/02-数据模型.md 保持一致：
 * MONTHLY / QUARTERLY / SEMI_ANNUAL / ANNUAL
 * 回归测试：防止再次引入 SEMI_ANNUALLY / ANNUALLY 这类与数据库不一致的值
 */
describe('CreateContractDto 校验（回归）', () => {
  const base = {
    buildingId: 'building-001',
    roomId: 'room-001',
    tenantId: 'tenant-001',
    rentAmount: 100000,
    depositAmount: 200000,
    paymentDay: 5,
    startDate: '2026-10-01',
    endDate: '2027-09-30',
  };

  it('应接受数据库标准付款周期（含 SEMI_ANNUAL / ANNUAL）', async () => {
    for (const paymentCycle of ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']) {
      const dto = plainToInstance(CreateContractDto, { ...base, paymentCycle });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors).toHaveLength(0);
    }
  });

  it('应拒绝与数据库枚举不一致的旧值（SEMI_ANNUALLY / ANNUALLY）', async () => {
    for (const paymentCycle of ['SEMI_ANNUALLY', 'ANNUALLY']) {
      const dto = plainToInstance(CreateContractDto, { ...base, paymentCycle });

      const errors = await validateLikeGlobalPipe(dto);

      expect(errors.some((error) => error.property === 'paymentCycle')).toBe(true);
    }
  });
});
