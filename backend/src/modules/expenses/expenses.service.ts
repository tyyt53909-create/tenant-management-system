import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { assertStaffBuildingAccess, getStaffBuildingScope, type ScopedStaffContext } from '../../common/utils/building-scope.util.js';
import { CancelExpenseDto, CorrectExpenseDto, CreateExpenseDto, QueryExpensesDto, RecordExpensePaymentDto } from './dto/expense.dto.js';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService, private readonly clock: BusinessClock, private readonly audit: AuditLogService) {}
  async buildings(user: ScopedStaffContext) {
    const scope = await getStaffBuildingScope(this.prisma, user);
    return this.prisma.building.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
  async list(query: QueryExpensesDto, user: ScopedStaffContext) {
    if (query.buildingId) await assertStaffBuildingAccess(this.prisma, user, query.buildingId);
    const scope = await getStaffBuildingScope(this.prisma, user);
    return this.prisma.operatingExpense.findMany({
      where: { ...(query.buildingId ? { buildingId: query.buildingId } : scope ? { buildingId: { in: scope } } : {}),
        ...(query.status === 'PAID' ? { cancelledAt: null, payment: { is: { paidDate: { lte: this.clock.todayUtc() } } } } : query.status === 'UNPAID' ? { cancelledAt: null, payment: { is: null } } : query.status === 'CANCELLED' ? { cancelledAt: { not: null } } : {}) },
      include: { payment: true, building: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' },
    });
  }
  async create(dto: CreateExpenseDto, user: ScopedStaffContext) {
    await assertStaffBuildingAccess(this.prisma, user, dto.buildingId);
    if (![dto.category, dto.description, dto.requestKey].every(x => x.trim()) || (dto.sourceReference !== undefined && !dto.sourceReference.trim())) throw new BadRequestException('内容不能为空');
    if (!dto.sourceReference?.trim() && !dto.publicUtilityBillId) throw new BadRequestException('需要支出来源');
    const prior = await this.prisma.operatingExpense.findUnique({ where: { requestKey: dto.requestKey } });
    if (prior) return this.checkCreateReplay(prior, dto, user);
    if (!await this.prisma.building.findUnique({ where: { id: dto.buildingId }, select: { id: true } })) throw new NotFoundException('楼栋不存在');
    if (dto.publicUtilityBillId) {
      const bill = await this.prisma.publicUtilityBill.findUnique({ where: { id: dto.publicUtilityBillId } });
      if (!bill || bill.buildingId !== dto.buildingId || bill.totalAmount !== dto.amount) throw new BadRequestException('公区单据与楼栋或金额不匹配');
    }
    try {
      return await this.prisma.operatingExpense.create({ data: { ...dto, createdById: user.userId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.operatingExpense.findUnique({ where: { requestKey: dto.requestKey } });
        if (existing) return this.checkCreateReplay(existing, dto, user);
        throw new ConflictException('该来源已有支出记录');
      }
      throw error;
    }
  }
  private checkCreateReplay(e: { buildingId: string; category: string; description: string; amount: number; sourceReference: string | null; publicUtilityBillId: string | null; createdById: string }, dto: CreateExpenseDto, user: ScopedStaffContext) {
    if (e.createdById !== user.userId || e.buildingId !== dto.buildingId || e.category !== dto.category || e.description !== dto.description || e.amount !== dto.amount || e.sourceReference !== (dto.sourceReference ?? null) || e.publicUtilityBillId !== (dto.publicUtilityBillId ?? null)) throw new ConflictException('请求标识已用于其他内容');
    return e;
  }
  private async checkAccess(id: string, user: ScopedStaffContext) {
    const expense = await this.prisma.operatingExpense.findUnique({ where: { id }, select: { buildingId: true } });
    if (!expense) throw new NotFoundException('支出不存在');
    await assertStaffBuildingAccess(this.prisma, user, expense.buildingId);
  }
  private async lockExpense(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "operating_expenses" WHERE "id" = ${id} FOR UPDATE`;
    const expense = await tx.operatingExpense.findUnique({ where: { id }, include: { payment: true } });
    if (!expense) throw new NotFoundException('支出不存在');
    return expense;
  }
  private assertEditable(expense: { cancelledAt: Date | null; payment: unknown; version: number }, expectedVersion: number) {
    if (expense.cancelledAt || expense.payment) throw new ConflictException('已付款或已取消的支出不能更改');
    if (expense.version !== expectedVersion) throw new ConflictException('支出已发生变化，请刷新后重试');
  }
  async correct(id: string, dto: CorrectExpenseDto, user: ScopedStaffContext & { ip?: string; userAgent?: string }) {
    if (!dto.reason.trim() || !dto.category.trim() || !dto.description.trim() || (dto.sourceReference !== undefined && !dto.sourceReference.trim())) throw new BadRequestException('内容及原因不能为空');
    await this.checkAccess(id, user);
    return this.prisma.$transaction(async tx => {
      const before = await this.lockExpense(tx, id);
      this.assertEditable(before, dto.expectedVersion);
      if (!dto.sourceReference && !before.publicUtilityBillId) throw new BadRequestException('需要支出来源');
      if (before.publicUtilityBillId) {
        const bill = await tx.publicUtilityBill.findUnique({ where: { id: before.publicUtilityBillId } });
        if (!bill || bill.buildingId !== before.buildingId || bill.totalAmount !== dto.amount) throw new BadRequestException('公区单据与楼栋或金额不匹配');
      }
      const after = await tx.operatingExpense.update({ where: { id }, data: { category: dto.category, description: dto.description, amount: dto.amount, sourceReference: dto.sourceReference ?? null, version: { increment: 1 } } });
      await this.audit.recordEvent({ tx, actorId: user.userId, action: 'EXPENSE_CORRECT', entityType: 'OperatingExpense', entityId: id, before, after, reason: dto.reason, ip: user.ip, userAgent: user.userAgent });
      return after;
    });
  }
  async cancel(id: string, dto: CancelExpenseDto, user: ScopedStaffContext & { ip?: string; userAgent?: string }) {
    if (!dto.reason.trim()) throw new BadRequestException('取消原因不能为空');
    await this.checkAccess(id, user);
    return this.prisma.$transaction(async tx => {
      const before = await this.lockExpense(tx, id);
      this.assertEditable(before, dto.expectedVersion);
      const after = await tx.operatingExpense.update({ where: { id }, data: { cancelledAt: this.clock.now(), cancelledById: user.userId, version: { increment: 1 } } });
      await this.audit.recordEvent({ tx, actorId: user.userId, action: 'EXPENSE_CANCEL', entityType: 'OperatingExpense', entityId: id, before, after, reason: dto.reason, ip: user.ip, userAgent: user.userAgent });
      return after;
    });
  }
  async pay(id: string, dto: RecordExpensePaymentDto, user: ScopedStaffContext) {
    if (!dto.evidence.trim() || !dto.requestKey.trim()) throw new BadRequestException('付款凭证不能为空');
    const date = this.clock.parseDateOnly(dto.paidDate);
    if (!date || date > this.clock.todayUtc()) throw new BadRequestException('付款日期无效或晚于业务今天');
    await this.checkAccess(id, user);
    const replay = async () => {
      const p = await this.prisma.expensePayment.findUnique({ where: { requestKey: dto.requestKey } });
      if (!p) return null;
      if (p.expenseId !== id || p.recordedById !== user.userId || p.amount !== dto.amount || p.paidDate.toISOString().slice(0, 10) !== dto.paidDate || p.evidence !== dto.evidence) throw new ConflictException('请求标识已用于其他内容');
      return p;
    };
    const existing = await replay(); if (existing) return existing;
    try {
      return await this.prisma.$transaction(async tx => {
        const expense = await this.lockExpense(tx, id);
        if (expense.payment?.requestKey === dto.requestKey) {
          const p = expense.payment;
          if (p.recordedById !== user.userId || p.amount !== dto.amount || p.paidDate.toISOString().slice(0, 10) !== dto.paidDate || p.evidence !== dto.evidence) throw new ConflictException('请求标识已用于其他内容');
          return p;
        }
        this.assertEditable(expense, dto.expectedVersion);
        if (expense.amount !== dto.amount) throw new BadRequestException('付款金额须等于支出金额');
        return tx.expensePayment.create({ data: { expenseId: id, amount: dto.amount, paidDate: date, evidence: dto.evidence, requestKey: dto.requestKey, recordedById: user.userId } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { const p = await replay(); if (p) return p; throw new ConflictException('支出已记录付款'); }
      throw error;
    }
  }
}
