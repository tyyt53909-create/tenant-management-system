import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('SettingsService（T276）', () => {
  let service: SettingsService;
  let prisma: any;

  const actor = { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(async () => {
    prisma = {
      systemSetting: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SettingsService);
  });

  it('无数据库记录时返回注册表默认值并标记 isDefault', async () => {
    const list = await service.list();
    expect(list).toHaveLength(5);
    const threshold = list.find((item) => item.key === 'prepay.defaultLowBalanceThreshold');
    expect(threshold).toMatchObject({ value: 10000, defaultValue: 10000, isDefault: true });
    const autoDeduct = list.find((item) => item.key === 'prepay.autoDeductEnabled');
    expect(autoDeduct).toMatchObject({ value: false, defaultValue: false, isDefault: true });
    const lateFee = list.find((item) => item.key === 'billing.defaultLateFeeRule');
    expect(lateFee?.value).toEqual({
      graceDays: 0,
      dailyRate: null,
      fixedDaily: null,
      cap: null,
    });
  });

  it('未知 key 读取/写入返回 404', async () => {
    await expect(service.getOne('billing.unknown')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('billing.unknown', 1, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('更新阈值：upsert + before/after 审计', async () => {
    prisma.systemSetting.findUnique.mockResolvedValueOnce({
      key: 'prepay.defaultLowBalanceThreshold',
      value: 10000,
    });
    prisma.systemSetting.upsert.mockResolvedValue({
      key: 'prepay.defaultLowBalanceThreshold',
      value: 20000,
      updatedBy: 'admin-1',
      updatedAt: new Date('2026-10-24T10:00:00Z'),
    });

    const result = await service.update('prepay.defaultLowBalanceThreshold', 20000, actor);

    expect(result).toMatchObject({ value: 20000, isDefault: false, updatedBy: 'admin-1' });
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'prepay.defaultLowBalanceThreshold' },
        update: expect.objectContaining({ value: 20000, updatedBy: 'admin-1' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'UPDATE_SETTING',
        entityType: 'SystemSetting',
        entityId: 'prepay.defaultLowBalanceThreshold',
        changes: { before: 10000, after: 20000 },
      }),
    });
  });

  it('非法阈值/未知滞纳金字段被拒绝且不落库', async () => {
    await expect(
      service.update('prepay.defaultLowBalanceThreshold', -1, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('billing.defaultLateFeeRule', { graceDays: 3, typo: 1 }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('滞纳金规则归一化：空值 → 全 null 的固定结构', async () => {
    prisma.systemSetting.upsert.mockImplementation(async ({ create }: any) => ({
      ...create,
      updatedAt: new Date(),
    }));
    const result = await service.update('billing.defaultLateFeeRule', null, actor);
    expect(result.value).toEqual({
      graceDays: 0,
      dailyRate: null,
      fixedDaily: null,
      cap: null,
    });
  });

  it('getValue 有数据库值时优先返回数据库值', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ key: 'prepay.defaultLowBalanceThreshold', value: 5000 });
    expect(await service.getValue('prepay.defaultLowBalanceThreshold')).toBe(5000);
  });
});
