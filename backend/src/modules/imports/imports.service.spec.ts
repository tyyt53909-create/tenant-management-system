import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportsService } from './imports.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';

describe('ImportsService', () => {
  let service: ImportsService;
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };

  const tenantCsv = 'name,phone\n张三,13800138000\n李四,13900139000\n';

  beforeEach(async () => {
    prisma = {
      building: { findUnique: vi.fn().mockResolvedValue({ id: 'building-001' }) },
      tenant: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      contract: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
      room: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
      bill: { findFirst: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(prisma)),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(ImportsService);
  });

  describe('模板', () => {
    it('含 BOM、表头与一行示例', () => {
      const csv = service.template('tenants');
      expect(csv.startsWith('﻿')).toBe(true);
      const [header, sample] = csv.slice(1).split('\r\n');
      expect(header).toBe('name,phone,email,emergencyContact,emergencyPhone,notes');
      expect(sample).toContain('13800138000');
    });

    it('不支持的实体 → 400', () => {
      expect(() => service.template('rooms' as never)).toThrow(BadRequestException);
    });
  });

  describe('租客导入', () => {
    it('预检通过、不写库', async () => {
      const result = await service.preview('tenants', tenantCsv);

      expect(result).toMatchObject({ entity: 'tenants', totalRows: 2, imported: 2, skipped: 0, errors: [], dryRun: true });
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it('已存在的手机号记为跳过', async () => {
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 't1' }).mockResolvedValueOnce(null);

      const result = await service.preview('tenants', tenantCsv);

      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(1);
    });

    it('缺少必需列 → 400', async () => {
      await expect(service.preview('tenants', 'name\n张三\n')).rejects.toThrow(/缺少必需列：phone/);
    });

    it('手机号格式错误 → 返回行号', async () => {
      const result = await service.preview('tenants', 'name,phone\n张三,123\n');

      expect(result.errors).toEqual([{ line: 2, message: '手机号格式错误' }]);
      expect(result.imported).toBe(0);
    });

    it('有错误时即使 dryRun=false 也不写库', async () => {
      const result = await service.commit('tenants', 'name,phone\n张三,123\n', actor(), { dryRun: false });

      expect(result.errors).toHaveLength(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('dryRun=false 且无错误 → 事务写入并记审计', async () => {
      const result = await service.commit('tenants', tenantCsv, actor(), { dryRun: false });

      expect(result).toMatchObject({ imported: 2, errors: [], skipped: 0 });
      expect(prisma.tenant.create).toHaveBeenCalledTimes(2);
      expect(prisma.tenant.create.mock.calls[0][0].data).toMatchObject({ name: '张三', phone: '13800138000' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'IMPORT', entityId: 'tenants' }));
    });

    it('默认 dryRun 为 true：commit 不写库', async () => {
      await service.commit('tenants', tenantCsv, actor());

      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });
  });

  describe('合同导入', () => {
    const csv = 'contractNumber,tenantPhone,roomNumber,floor,rentAmount,depositAmount,paymentCycle,paymentDay,startDate,endDate\nHT-1,13800138000,101,1,1800.00,1800.00,MONTHLY,5,2026-01-01,2026-12-31\n';

    it('租客或房源不存在 → 行号错误', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue(null);
      prisma.room.findFirst.mockResolvedValue(null);

      const result = await service.preview('contracts', csv);

      expect(result.errors.map((error) => error.message)).toEqual([
        '租客不存在（手机号 13800138000）',
        '房源不存在（1 层 101）',
      ]);
    });

    it('金额与周期非法 → 错误', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.room.findFirst.mockResolvedValue({ id: 'r1' });

      const result = await service.preview(
        'contracts',
        'contractNumber,tenantPhone,roomNumber,rentAmount,depositAmount,paymentCycle,paymentDay,startDate,endDate\nHT-2,13800138000,101,0,0,WEEKLY,0,2026-12-31,2026-01-01\n',
      );

      expect(result.errors.map((error) => error.message)).toEqual([
        'rentAmount 需为大于 0 的金额，如 1800.00',
        'paymentCycle 只能是 MONTHLY/QUARTERLY/SEMI_ANNUAL/ANNUAL',
        'paymentDay 需为 1–31 的整数',
        'endDate 必须晚于 startDate',
      ]);
    });

    it('校验通过 → 全部通过', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' });
      prisma.room.findFirst.mockResolvedValue({ id: 'r1' });

      const result = await service.preview('contracts', csv);

      expect(result).toMatchObject({ imported: 1, errors: [] });
    });
  });

  describe('账单导入', () => {
    const csv = 'contractNumber,billType,period,amount,paidAmount,dueDate\nHT-1,RENT,2026-01,1800.00,0.00,2026-01-05\n';

    it('合同不存在 → 错误', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      const result = await service.preview('bills', csv);

      expect(result.errors[0].message).toContain('合同不存在');
    });

    it('已缴金额大于应收 → 错误', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });

      const result = await service.preview('bills', 'contractNumber,billType,period,amount,paidAmount,dueDate\nHT-1,RENT,2026-01,100.00,200.00,2026-01-05\n');

      expect(result.errors.map((error) => error.message)).toContain('paidAmount 不能大于 amount');
    });

    it('账期与类型组合已存在 → 跳过', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.bill.findFirst.mockResolvedValue({ id: 'b1' });

      const result = await service.preview('bills', csv);

      expect(result).toMatchObject({ skipped: 1, imported: 0, errors: [] });
    });

    it('写入时金额字符串精确转分', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.contract.findUniqueOrThrow.mockResolvedValue({ id: 'c1' });
      prisma.bill.findFirst.mockResolvedValue(null);

      await service.commit('bills', csv, actor(), { dryRun: false });

      expect(prisma.bill.create.mock.calls[0][0].data).toMatchObject({
        contractId: 'c1',
        amount: 180000,
        paidAmount: 0,
        period: '2026-01',
        billNumber: 'IMP-HT-1-RENT-2026-01',
      });
    });
  });
});

function actor() {
  return { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'vitest' };
}
