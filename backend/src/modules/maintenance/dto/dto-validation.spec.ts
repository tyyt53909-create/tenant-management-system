import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateMaintenanceDto } from './create-maintenance.dto.js';
import { QueryMaintenanceDto } from './query-maintenance.dto.js';
import { UpdateMaintenanceDto } from './update-maintenance.dto.js';
import {
  DispatchMaintenanceDto,
  CompleteMaintenanceDto,
  ConfirmMaintenanceDto,
  TransferExpenseDto,
} from './work-order-actions.dto.js';

/** 复刻全局 ValidationPipe 配置（main.ts）：whitelist + forbidNonWhitelisted */
const validateLikeGlobalPipe = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

/**
 * 报修状态必须与 Prisma schema / docs/02-数据模型.md 保持一致：
 * SUBMITTED / ACKNOWLEDGED / ASSIGNED / IN_PROGRESS / PENDING_CONFIRM / COMPLETED / CANCELLED
 * 回归测试：防止再次引入 RESOLVED / CLOSED 这类与数据库不一致的值
 */
const PRISMA_STATUSES = [
  'SUBMITTED',
  'ACKNOWLEDGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_CONFIRM',
  'COMPLETED',
  'CANCELLED',
];

describe('Maintenance DTO 状态校验（回归）', () => {
  it('更新应接受数据库全部 7 种状态', async () => {
    for (const status of PRISMA_STATUSES) {
      const errors = await validateLikeGlobalPipe(plainToInstance(UpdateMaintenanceDto, { status }));

      expect(errors).toHaveLength(0);
    }
  });

  it('筛选应接受数据库状态值', async () => {
    const errors = await validateLikeGlobalPipe(plainToInstance(QueryMaintenanceDto, { status: 'COMPLETED' }));

    expect(errors).toHaveLength(0);
  });

  it('应拒绝与数据库不一致的旧值（RESOLVED / CLOSED）', async () => {
    for (const status of ['RESOLVED', 'CLOSED']) {
      const updateErrors = await validateLikeGlobalPipe(plainToInstance(UpdateMaintenanceDto, { status }));
      expect(updateErrors.some((error) => error.property === 'status')).toBe(true);

      const queryErrors = await validateLikeGlobalPipe(plainToInstance(QueryMaintenanceDto, { status }));
      expect(queryErrors.some((error) => error.property === 'status')).toBe(true);
    }
  });
});

/**
 * T138：租客自助报修 —— roomId/tenantId 改为可选（租客端由服务端推导，管理员仍需显式传入）
 */
describe('CreateMaintenanceDto 校验（T138）', () => {
  const base = {
    title: '卫生间漏水',
    description: '一直在滴水',
    category: 'PLUMBING',
  };

  it('租客自助报修（不带 roomId/tenantId）应通过', async () => {
    const dto = plainToInstance(CreateMaintenanceDto, { ...base });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('管理员指定 roomId/tenantId 应通过', async () => {
    const dto = plainToInstance(CreateMaintenanceDto, {
      ...base,
      roomId: 'room-001',
      tenantId: 'tenant-001',
    });

    const errors = await validateLikeGlobalPipe(dto);

    expect(errors).toHaveLength(0);
  });

  it('缺标题或描述应被拒绝', async () => {
    const noTitle = await validateLikeGlobalPipe(
      plainToInstance(CreateMaintenanceDto, { ...base, title: '' }),
    );
    expect(noTitle.some((error) => error.property === 'title')).toBe(true);

    const noDescription = await validateLikeGlobalPipe(
      plainToInstance(CreateMaintenanceDto, { ...base, description: '' }),
    );
    expect(noDescription.some((error) => error.property === 'description')).toBe(true);
  });

  it('DispatchMaintenanceDto 校验', async () => {
    const valid = plainToInstance(DispatchMaintenanceDto, {
      assignedMaintainerId: 'm-1',
      assignedTo: '张师傅',
      notes: '带梯子',
    });
    expect(await validateLikeGlobalPipe(valid)).toHaveLength(0);

    const invalid = plainToInstance(DispatchMaintenanceDto, { assignedMaintainerId: '' });
    expect((await validateLikeGlobalPipe(invalid)).length).toBeGreaterThan(0);
  });

  it('CompleteMaintenanceDto 校验', async () => {
    const valid = plainToInstance(CompleteMaintenanceDto, {
      resolution: '修好了',
      laborCost: 2000,
      materialCost: 3000,
      tenantFault: true,
      faultReason: '私拆电线',
    });
    expect(await validateLikeGlobalPipe(valid)).toHaveLength(0);

    const invalid = plainToInstance(CompleteMaintenanceDto, { resolution: '', laborCost: -100 });
    const errors = await validateLikeGlobalPipe(invalid);
    expect(errors.some((e) => e.property === 'resolution')).toBe(true);
    expect(errors.some((e) => e.property === 'laborCost')).toBe(true);
  });

  it('ConfirmMaintenanceDto 校验', async () => {
    const valid = plainToInstance(ConfirmMaintenanceDto, { accepted: true, rating: 5 });
    expect(await validateLikeGlobalPipe(valid)).toHaveLength(0);

    const invalid = plainToInstance(ConfirmMaintenanceDto, { accepted: 'not-bool' as any, rating: 10 });
    const errors = await validateLikeGlobalPipe(invalid);
    expect(errors.some((e) => e.property === 'accepted')).toBe(true);
    expect(errors.some((e) => e.property === 'rating')).toBe(true);
  });

  it('TransferExpenseDto 校验', async () => {
    const valid = plainToInstance(TransferExpenseDto, { dueDate: '2026-11-01', notes: '扣费' });
    expect(await validateLikeGlobalPipe(valid)).toHaveLength(0);
  });
});
