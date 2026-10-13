import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryCheckoutsDto } from './query-checkouts.dto.js';
import { UpdateCheckoutDto } from './update-checkout.dto.js';
import { CreateCheckoutDto } from './create-checkout.dto.js';

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

/**
 * T147 验收第 11 步：押金扣除项必须有类别（itemType）/金额（amount）/说明（description）
 * T148 回归：缺少任一项必须在 DTO 层被拒绝
 */
describe('Checkout 结算明细（items）DTO 校验', () => {
  const baseCheckout = {
    contractId: 'contract-1',
    roomId: 'room-1',
    checkoutDate: '2026-10-13',
    totalRefund: 100000,
    processedBy: 'admin-1',
  };

  const validateItems = async (items: any[]) => {
    const errors = await validateLikeGlobalPipe(
      plainToInstance(CreateCheckoutDto, { ...baseCheckout, items }),
    );
    return errors.find((error) => error.property === 'items');
  };

  /** 递归收集嵌套校验错误字段名（数组项错误会多一层 property='0' 的包装） */
  const collectProperties = (error: any): string[] => [
    ...(error?.property !== undefined ? [String(error.property)] : []),
    ...(error?.children ?? []).flatMap(collectProperties),
  ];

  it('类别/金额/说明齐全 → 通过', async () => {
    const error = await validateItems([
      { itemType: 'DEPOSIT_DEDUCTION', description: '墙面破损', amount: 80000 },
      { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 120000 },
    ]);

    expect(error).toBeUndefined();
  });

  it('缺少说明 → 拒绝', async () => {
    const properties = collectProperties(
      await validateItems([{ itemType: 'DEPOSIT_DEDUCTION', amount: 80000 }]),
    );

    expect(properties).toContain('description');
  });

  it('缺少类别 → 拒绝', async () => {
    const properties = collectProperties(
      await validateItems([{ description: '墙面破损', amount: 80000 }]),
    );

    expect(properties).toContain('itemType');
  });

  it('非法类别 → 拒绝', async () => {
    const properties = collectProperties(
      await validateItems([{ itemType: 'NOT_A_TYPE', description: '墙面破损', amount: 80000 }]),
    );

    expect(properties).toContain('itemType');
  });

  it('金额为负 → 拒绝', async () => {
    const properties = collectProperties(
      await validateItems([{ itemType: 'DEPOSIT_DEDUCTION', description: '墙面破损', amount: -1 }]),
    );

    expect(properties).toContain('amount');
  });

  it('明细为空数组 → 拒绝（ArrayMinSize）', async () => {
    const error = await validateItems([]);

    expect(error).toBeDefined();
  });
});
