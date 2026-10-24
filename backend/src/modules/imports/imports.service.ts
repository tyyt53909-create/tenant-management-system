import { parseDateOnly } from '../../common/business-clock/business-clock.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { parseCsv, toRecords } from './csv-parse.js';
import { IMPORT_ENTITIES, PAYMENT_CYCLES, type ImportEntity } from './entities.js';

export type ImportEntityKey = ImportEntity['key'];

export interface RowError {
  line: number;
  message: string;
}

export interface ImportResult {
  entity: ImportEntityKey;
  /** 文件里识别到的数据行（不含表头与空行） */
  totalRows: number;
  /** 已存在且内容一致，跳过 */
  skipped: number;
  /** 通过校验、将写入（或已写入）的行数 */
  imported: number;
  errors: RowError[];
  dryRun: boolean;
}

type Row = Record<string, string>;

/**
 * CSV 批量导入（T216，docs/00 §2.2「导入现有资料」）。
 *
 * 设计取舍：
 * - 先整份校验，**任一行有错就整批不写**。半批成功会让「哪些进来了」难以追踪，
 *   而补录场景可以修好文件重跑，代价低。
 * - 判重使用业务唯一键：租客=手机号、合同=合同编号、账单=合同编号+账期+类型。
 *   已存在且内容一致记为 skipped，不覆盖人工在系统里改过的数据。
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** 下载模板：表头 + 一行示例 */
  template(entityKey: ImportEntityKey): string {
    const entity = this.requireEntity(entityKey);
    const header = entity.columns.map((column) => column.name);
    const sample = entity.columns.map((column) => column.sample);
    const escape = (value: string) =>
      value.includes(',') || value.includes('"') || value.includes('\n')
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    return '﻿' + [[...header], sample].map((line) => line.map(escape).join(',')).join('\r\n');
  }

  async preview(
    entityKey: ImportEntityKey,
    content: string,
    options: { buildingId?: string } = {},
  ): Promise<ImportResult> {
    return this.run(entityKey, content, { ...options, dryRun: true });
  }

  async commit(
    entityKey: ImportEntityKey,
    content: string,
    actor: { userId: string; ip: string; userAgent: string },
    options: { buildingId?: string; dryRun?: boolean } = {},
  ): Promise<ImportResult> {
    const dryRun = options.dryRun ?? true;
    const result = await this.run(entityKey, content, { ...options, dryRun });
    // 只有真正写入成功才记审计；预检与有错误的批次不产生审计噪音
    if (!dryRun && result.errors.length === 0) {
      await this.auditLogService.log({
        userId: actor.userId,
        action: 'IMPORT',
        entityType: 'Import',
        entityId: entityKey,
        changes: { totalRows: result.totalRows, imported: result.imported, skipped: result.skipped, errors: result.errors.length },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    return result;
  }

  private async run(
    entityKey: ImportEntityKey,
    content: string,
    options: { buildingId?: string; dryRun: boolean },
  ): Promise<ImportResult> {
    const entity = this.requireEntity(entityKey);
    if (!content?.trim()) {
      throw new BadRequestException('文件为空');
    }
    const parsed = parseCsv(content);
    if (parsed.header.length === 0) {
      throw new BadRequestException('文件没有表头');
    }
    const missing = entity.columns
      .filter((column) => column.required && !parsed.header.includes(column.name))
      .map((column) => column.name);
    if (missing.length) {
      throw new BadRequestException(`缺少必需列：${missing.join('、')}`);
    }

    const records = toRecords(parsed);
    if (records.length === 0) {
      throw new BadRequestException('文件没有数据行');
    }
    if (records.length > 5000) {
      throw new BadRequestException('单次最多导入 5000 行，请拆分文件');
    }

    const buildingId = await this.resolveBuildingId(options.buildingId);
    const errors: RowError[] = [];
    let skipped = 0;
    let imported = 0;

    const handler = {
      tenants: () => this.importTenants(records, errors, () => imported++, () => skipped++),
      contracts: () => this.importContracts(records, buildingId, errors, () => imported++, () => skipped++),
      bills: () => this.importBills(records, buildingId, errors, () => imported++, () => skipped++),
    }[entityKey];

    await handler();

    // 任一行有错就不写（dryRun 时本来也不写）
    if (errors.length === 0 && !options.dryRun) {
      await this.writeInTransaction(entityKey, records, buildingId);
    }

    return {
      entity: entityKey,
      totalRows: records.length,
      skipped: options.dryRun ? skipped : 0,
      imported: errors.length === 0 ? imported : 0,
      errors,
      dryRun: options.dryRun,
    };
  }

  /** 校验阶段：只判断能否写、是否重复，不落库 */
  private async importTenants(records: { line: number; record: Row }[], errors: RowError[], ok: () => void, skip: () => void) {
    for (const { line, record } of records) {
      const name = record.name?.trim();
      const phone = record.phone?.trim();
      if (!name) errors.push({ line, message: '姓名不能为空' });
      if (!/^1[3-9]\d{9}$/.test(phone ?? '')) errors.push({ line, message: '手机号格式错误' });
      if (!name || !/^1[3-9]\d{9}$/.test(phone ?? '')) continue;
      const existing = await this.prisma.tenant.findUnique({ where: { phone }, select: { id: true } });
      if (existing) skip();
      else ok();
    }
  }

  private async importContracts(
    records: { line: number; record: Row }[],
    _buildingId: string,
    errors: RowError[],
    ok: () => void,
    skip: () => void,
  ) {
    for (const { line, record } of records) {
      const contractNumber = record.contractNumber?.trim();
      if (!contractNumber) {
        errors.push({ line, message: '合同编号不能为空' });
        continue;
      }
      const existing = await this.prisma.contract.findUnique({ where: { contractNumber }, select: { id: true } });
      if (existing) {
        skip();
        continue;
      }
      const tenant = await this.prisma.tenant.findUnique({ where: { phone: record.tenantPhone?.trim() ?? '' }, select: { id: true } });
      if (!tenant) errors.push({ line, message: `租客不存在（手机号 ${record.tenantPhone || '空'}）` });
      const room = await this.findRoom(record);
      if (!room) errors.push({ line, message: `房源不存在（${record.floor || '?'} 层 ${record.roomNumber || '空'}）` });
      if (!isAmountAboveZero(record.rentAmount)) errors.push({ line, message: 'rentAmount 需为大于 0 的金额，如 1800.00' });
      if (!isAmountAtLeastZero(record.depositAmount)) errors.push({ line, message: 'depositAmount 需为不小于 0 的金额' });
      if (!PAYMENT_CYCLES.includes(record.paymentCycle as never)) errors.push({ line, message: `paymentCycle 只能是 ${PAYMENT_CYCLES.join('/')}` });
      const day = Number(record.paymentDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) errors.push({ line, message: 'paymentDay 需为 1–31 的整数' });
      const start = parseDate(record.startDate);
      const end = parseDate(record.endDate);
      if (!start || !end) errors.push({ line, message: '日期格式需为 YYYY-MM-DD' });
      else if (end <= start) errors.push({ line, message: 'endDate 必须晚于 startDate' });
      if (tenant && room && isAmountAboveZero(record.rentAmount) && isAmountAtLeastZero(record.depositAmount) && PAYMENT_CYCLES.includes(record.paymentCycle as never) && Number.isInteger(day) && day >= 1 && day <= 31 && start && end && end > start) {
        ok();
      }
    }
  }

  private async importBills(
    records: { line: number; record: Row }[],
    _buildingId: string,
    errors: RowError[],
    ok: () => void,
    skip: () => void,
  ) {
    for (const { line, record } of records) {
      const contractNumber = record.contractNumber?.trim();
      const contract = contractNumber
        ? await this.prisma.contract.findUnique({ where: { contractNumber }, select: { id: true } })
        : null;
      if (!contract) {
        errors.push({ line, message: `合同不存在（${contractNumber || '空'}）` });
        continue;
      }
      if (!['RENT', 'UTILITY', 'OTHER'].includes(record.billType)) {
        errors.push({ line, message: 'billType 只能是 RENT/UTILITY/OTHER' });
      }
      if (!/^\d{4}-\d{2}$/.test(record.period ?? '')) {
        errors.push({ line, message: 'period 格式需为 YYYY-MM' });
      }
      if (!isAmountAboveZero(record.amount)) errors.push({ line, message: 'amount 需为大于 0 的金额' });
      const paid = record.paidAmount ? moneyToCents(record.paidAmount) : 0;
      if (paid === null) errors.push({ line, message: 'paidAmount 不是有效金额' });
      else if (paid > (moneyToCents(record.amount) ?? 0)) errors.push({ line, message: 'paidAmount 不能大于 amount' });
      if (!parseDate(record.dueDate)) errors.push({ line, message: 'dueDate 格式需为 YYYY-MM-DD' });
      if (!['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'].includes(record.status || 'PENDING')) {
        errors.push({ line, message: 'status 只能是 PENDING/PARTIAL/PAID/OVERDUE/CANCELLED' });
      }
      const existing = await this.prisma.bill.findFirst({
        where: { contractId: contract.id, period: record.period, billType: record.billType as never },
        select: { id: true },
      });
      if (errors.every((error) => error.line !== line)) {
        if (existing) skip();
        else ok();
      }
    }
  }

  /** 校验全部通过后才调用：整批一个事务，失败全部回滚 */
  private async writeInTransaction(entityKey: ImportEntityKey, records: { record: Row }[], buildingId: string) {
    await this.prisma.$transaction(
      async (tx) => {
        if (entityKey === 'tenants') {
          for (const { record } of records) {
            await tx.tenant.create({
              data: {
                name: record.name.trim(),
                phone: record.phone.trim(),
                email: record.email?.trim() || null,
                emergencyContact: record.emergencyContact?.trim() || null,
                emergencyPhone: record.emergencyPhone?.trim() || null,
                notes: record.notes?.trim() || null,
              },
            });
          }
          return;
        }
        if (entityKey === 'contracts') {
          for (const { record } of records) {
            const tenant = await tx.tenant.findUniqueOrThrow({ where: { phone: record.tenantPhone.trim() } });

            const room = await tx.room.findFirstOrThrow({ where: this.roomWhere(record) });
            await tx.contract.create({
              data: {
                buildingId,
                roomId: room.id,
                tenantId: tenant.id,
                contractNumber: record.contractNumber.trim(),
                rentAmount: moneyToCents(record.rentAmount) ?? 0,
                depositAmount: moneyToCents(record.depositAmount) ?? 0,
                paymentCycle: record.paymentCycle as never,
                paymentDay: Number(record.paymentDay),
                startDate: parseDate(record.startDate)!,
                endDate: parseDate(record.endDate)!,
                status: (record.status || 'ACTIVE') as never,
                lateFeeRule: {},
              },
            });
          }
          return;
        }
        for (const { record } of records) {
          const contract = await tx.contract.findUniqueOrThrow({ where: { contractNumber: record.contractNumber.trim() } });
          const amount = moneyToCents(record.amount) ?? 0;
          const paidAmount = record.paidAmount ? moneyToCents(record.paidAmount) ?? 0 : 0;
          await tx.bill.create({
            data: {
              contractId: contract.id,
              billNumber: `IMP-${record.contractNumber.trim()}-${record.billType}-${record.period}`,
              billType: record.billType as never,
              period: record.period,
              amount,
              paidAmount,
              snapshot: { imported: true, importedAt: new Date().toISOString() },
              dueDate: parseDate(record.dueDate)!,
              status: (record.status || 'PENDING') as never,
              dedupKey: null,
            },
          });
        }
      },
      { timeout: 60_000 },
    );
  }

  private roomWhere(record: Row): Prisma.RoomWhereInput {
    const floor = Number(record.floor);
    return {
      roomNumber: record.roomNumber.trim(),
      ...(Number.isInteger(floor) ? { floor } : {}),
    };
  }

  private async findRoom(record: Row) {
    return this.prisma.room.findFirst({ where: this.roomWhere(record), select: { id: true } });
  }

  private async resolveBuildingId(explicit?: string): Promise<string> {
    const id = explicit?.trim() || process.env.DEFAULT_BUILDING_ID || 'building-001';
    const building = await this.prisma.building.findUnique({ where: { id }, select: { id: true } });
    if (!building) {
      throw new NotFoundException(`楼栋不存在：${id}`);
    }
    return id;
  }

  private requireEntity(key: string): ImportEntity {
    const entity = IMPORT_ENTITIES[key as ImportEntityKey];
    if (!entity) {
      throw new BadRequestException(`不支持的导入类型：${key}`);
    }
    return entity;
  }
}

/** 金额字符串（元）转分；非法返回 null */
function moneyToCents(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function isAmountAboveZero(value: string | undefined): boolean {
  const cents = moneyToCents(value);
  return cents !== null && cents > 0;
}

function isAmountAtLeastZero(value: string | undefined): boolean {
  const cents = moneyToCents(value);
  return cents !== null && cents >= 0;
}

/** YYYY-MM-DD → Date（UTC 零点，与 Prisma @db.Date 一致） */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  return parseDateOnly(value);
}
