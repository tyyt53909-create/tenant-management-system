import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { RentReportDto } from './dto/rent-report.dto.js';
import { RentDetailDto, RentReportResponseDto } from './dto/rent-report-response.dto.js';
import { CurrentBalancesQueryDto, CurrentBalancesResponseDto, BalanceItemDto, UnassignedPrepayResponseDto } from './dto/current-balances.dto.js';
import { verifyBalance } from './balance-verification.js';
import { QueryStatisticsDto } from './dto/query-statistics.dto.js';
import { collectionRate, occupancyRate, sumAmounts } from '../../common/metrics/finance-metrics.js';

export interface PeriodRange {
  start: Date;
  end: Date;
}

/**
 * 统计（P1 / T155）
 *
 * 时间维度：当月 / 本季 / 本年 / 自定义
 * 空间维度：整楼 / 按楼层
 *
 * 口径说明（避免与仪表板混淆）：
 * - 收款额按 PaymentRecord.paidAt 落在区间内统计
 * - 出账额按 Bill.dueDate 落在区间内统计
 * - 出租率 = 区间末占用房间数 / 房间总数（占用 = 存在 ACTIVE 合同）
 * 不做同比环比（docs/09 §13 已确认）
 */
@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
  ) {}

  /** 管理口径：原收款、成功退款及纯更正分别按其业务月归集。 */
  async rentReport(query: RentReportDto): Promise<RentReportResponseDto> {
    return this.prisma.$transaction(async tx => {
      const [year, month] = query.month.split('-').map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1) - 2 * 86400000);
      const end = new Date(Date.UTC(year, month, 1) + 2 * 86400000);
      const dateStart = this.clock.parseDateOnly(`${query.month}-01`)!;
      const dateEnd = this.clock.addMonths(dateStart, 1);
      const today = this.clock.todayUtc();
      const rentBill = { billType: 'RENT' as const, contract: { buildingId: query.buildingId } };
      const [payments, refunds, undatedRefunds, reversals, orphanVoids, rooms, paidExpenses] = await Promise.all([
        tx.paymentRecord.findMany({
          where: { paidAt: { gte: start, lt: end }, status: { in: ['CONFIRMED', 'VOIDED'] }, bill: rentBill },
          take: 5001, select: { id: true, billId: true, paymentMethod: true, paidAt: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true },
        }),
        tx.refundRecord.findMany({
          where: { status: 'SUCCESS', successAt: { gte: start, lt: end }, bill: rentBill },
          take: 5001, select: { id: true, billId: true, paymentRecordId: true, amount: true, successAt: true, paymentRecord: { select: { id: true, billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true } }, reversal: { select: { billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true } } },
        }),
        // 没有完成时间不能确定受影响月份；不可凭创建/更新时间猜测。
        tx.refundRecord.findMany({ where: { status: 'SUCCESS', successAt: null, bill: rentBill }, take: 5001, select: { id: true, billId: true, paymentRecordId: true, amount: true } }),
        tx.paymentRecord.findMany({
          where: { status: 'REVERSAL', refundReversalId: null, paidAt: { gte: start, lt: end }, bill: rentBill },
          take: 5001, select: { id: true, reversalOfId: true, paidAt: true, amount: true, billPortion: true, lateFeePortion: true, reversalOf: { select: { billId: true, amount: true, billPortion: true, lateFeePortion: true, allocationVerified: true, status: true, refundRecords: { select: { id: true } } } }, billId: true },
        }),
        tx.paymentRecord.findMany({ where: { status: 'VOIDED', reversal: null, bill: rentBill }, take: 5001, select: { id: true, billId: true, voidedAt: true, amount: true, refundRecords: { where: { status: 'SUCCESS' }, select: { amount: true, reversal: { select: { amount: true, allocationVerified: true } } } } } }),
        tx.room.findMany({ where: { buildingId: query.buildingId }, select: { id: true } }),
        tx.expensePayment.aggregate({ where: { paidDate: { gte: dateStart, lt: dateEnd, lte: today }, expense: { buildingId: query.buildingId, cancelledAt: null } }, _sum: { amount: true } }),
      ]);
      const balance = await tx.prepayAccount.aggregate({ where: { roomId: { in: rooms.map(room => room.id) } }, _sum: { balanceCache: true } });
      if ([payments, refunds, undatedRefunds, reversals, orphanVoids].reduce((count, rows) => count + rows.length, 0) > 5000) throw new BadRequestException('租金明细超过 5000 笔，请缩小查询范围');
      const monthlyPayments = payments.filter(p => this.clock.monthKey(p.paidAt) === query.month);
      const validPayment = (p: typeof payments[number]) => p.allocationVerified === true && p.amount > 0 && p.billPortion >= 0 && p.lateFeePortion >= 0 && p.billPortion + p.lateFeePortion === p.amount;
      const verifiedPayments = monthlyPayments.filter(validPayment);
      const unknownAllocationCount = monthlyPayments.length - verifiedPayments.length;
      const verifiedAllocationRentSubtotal = verifiedPayments.reduce((sum, p) => sum + p.billPortion, 0);
      let verifiedRefundSubtotal = 0;
      let verifiedCorrectionSubtotal = 0;
      const details: RentDetailDto[] = monthlyPayments.map(p => {
        const verified = validPayment(p);
        return { id: p.id, type: 'PAYMENT', businessDate: this.clock.formatDate(p.paidAt), billId: p.billId, paymentId: p.id, refundId: null, amount: verified ? p.billPortion : null, grossAmount: p.amount, verified, unknownReason: verified ? null : '收款分配未核实或金额不一致', paymentMethod: p.paymentMethod };
      });
      const undatedDetails: RentDetailDto[] = undatedRefunds.map(r => ({ id: r.id, type: 'REFUND', businessDate: null, billId: r.billId, paymentId: r.paymentRecordId, refundId: r.id, amount: null, grossAmount: r.amount, verified: false, unknownReason: '成功退款缺少完成时间，无法归月', paymentMethod: null }));
      let unknownAdjustmentCount = undatedRefunds.length + orphanVoids.filter(p => {
        const refundsAccountForVoid = p.refundRecords.length > 0 && p.refundRecords.every(r => r.reversal?.allocationVerified === true && r.reversal.amount === -r.amount) && p.refundRecords.reduce((sum, r) => sum + r.amount, 0) === p.amount;
        const unknown = !refundsAccountForVoid && (!p.voidedAt || this.clock.monthKey(p.voidedAt) === query.month);
        if (unknown) {
          const item: RentDetailDto = { id: p.id, type: 'CORRECTION', businessDate: p.voidedAt ? this.clock.formatDate(p.voidedAt) : null, billId: p.billId, paymentId: p.id, refundId: null, amount: null, grossAmount: p.amount, verified: false, unknownReason: '作废缺少可核实的冲正或退款关联', paymentMethod: null };
          (p.voidedAt ? details : undatedDetails).push(item);
        }
        return unknown;
      }).length;
      for (const refund of refunds) {
        if (!refund.successAt || this.clock.monthKey(refund.successAt) !== query.month) continue;
        const r = refund.reversal;
        if (!r || refund.amount <= 0 || refund.paymentRecord.amount <= 0 || refund.billId !== refund.paymentRecord.billId || r.status !== 'REVERSAL' || r.billId !== refund.paymentRecord.billId || r.allocationVerified !== true || refund.paymentRecord.allocationVerified !== true || !['CONFIRMED', 'VOIDED'].includes(refund.paymentRecord.status) || r.amount !== -refund.amount || r.billPortion > 0 || r.lateFeePortion > 0 || r.billPortion + r.lateFeePortion !== r.amount || refund.amount > refund.paymentRecord.amount || refund.paymentRecord.billPortion < 0 || refund.paymentRecord.lateFeePortion < 0 || refund.paymentRecord.billPortion + refund.paymentRecord.lateFeePortion !== refund.paymentRecord.amount || -r.billPortion > refund.paymentRecord.billPortion || -r.lateFeePortion > refund.paymentRecord.lateFeePortion) { unknownAdjustmentCount++; details.push({ id: refund.id, type: 'REFUND', businessDate: this.clock.formatDate(refund.successAt), billId: refund.billId, paymentId: refund.paymentRecordId, refundId: refund.id, amount: null, grossAmount: refund.amount, verified: false, unknownReason: '退款、原收款或冲正分配关联不一致', paymentMethod: null }); continue; }
        details.push({ id: refund.id, type: 'REFUND', businessDate: this.clock.formatDate(refund.successAt), billId: refund.billId, paymentId: refund.paymentRecordId, refundId: refund.id, amount: r.billPortion, grossAmount: refund.amount, verified: true, unknownReason: null, paymentMethod: null });
        verifiedRefundSubtotal -= r.billPortion;
      }
      for (const r of reversals) {
        if (this.clock.monthKey(r.paidAt) !== query.month) continue;
        const original = r.reversalOf;
        if (!original || original.billId !== r.billId || original.refundRecords.length > 0 || original.allocationVerified !== true || original.status !== 'VOIDED' || original.amount <= 0 || original.billPortion < 0 || original.lateFeePortion < 0 || original.billPortion + original.lateFeePortion !== original.amount || r.amount !== -original.amount || r.billPortion !== -original.billPortion || r.lateFeePortion !== -original.lateFeePortion) { unknownAdjustmentCount++; details.push({ id: r.id, type: 'CORRECTION', businessDate: this.clock.formatDate(r.paidAt), billId: r.billId, paymentId: r.reversalOfId, refundId: null, amount: null, grossAmount: r.amount, verified: false, unknownReason: '更正与原收款的关联或金额不一致', paymentMethod: null }); continue; }
        details.push({ id: r.id, type: 'CORRECTION', businessDate: this.clock.formatDate(r.paidAt), billId: r.billId, paymentId: r.reversalOfId, refundId: null, amount: r.billPortion, grossAmount: r.amount, verified: true, unknownReason: null, paymentMethod: null });
        verifiedCorrectionSubtotal -= r.billPortion;
      }
      const complete = unknownAllocationCount === 0 && unknownAdjustmentCount === 0;
      const paidExpenseAmount = paidExpenses._sum.amount ?? 0;
      const subtotal = verifiedAllocationRentSubtotal - verifiedRefundSubtotal - verifiedCorrectionSubtotal;
      details.sort((a, b) => (a.businessDate ?? '').localeCompare(b.businessDate ?? '') || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      undatedDetails.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      return {
        details, undatedDetails, month: query.month, buildingId: query.buildingId,
        rentIncome: complete ? subtotal : null,
        verifiedAllocationRentSubtotal, verifiedRefundSubtotal, verifiedCorrectionSubtotal,
        unknownAllocationCount, unknownAdjustmentCount,
        paidExpenses: paidExpenseAmount,
        currentPrepayBalance: balance._sum.balanceCache ?? 0,
        status: complete ? 'complete' : 'incomplete',
        netOperatingIncome: complete ? subtotal - paidExpenseAmount : null,
        basis: '管理口径：租金本金按实收或预付抵扣月，成功退款按完成月，更正按发生月；扣除实付支出',
        limitations: [
          ...(unknownAllocationCount ? ['存在来源未核实的收款分配'] : []),
          ...(unknownAdjustmentCount ? ['存在退款或更正证据不足；无完成时间的退款可能影响任意月份'] : []),
          '当前预付余额不是月末余额；此报表不是税务或法定会计口径',
        ],
        hasRentAdjustments: refunds.length > 0 || reversals.length > 0 || undatedRefunds.length > 0 || orphanVoids.length > 0,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async currentBalances(query: CurrentBalancesQueryDto): Promise<CurrentBalancesResponseDto> {
    return this.prisma.$transaction(async tx => {
      const capturedAt = this.clock.now();
      const buildingId = query.buildingId;
      const building = buildingId ? await tx.building.findUnique({ where: { id: buildingId }, select: { id: true } }) : null;
      if (buildingId && !building) throw new BadRequestException('楼栋不存在');
      const rooms = await tx.room.findMany({ where: buildingId ? { buildingId } : {}, take: 5001, select: { id: true, buildingId: true } });
      if (rooms.length > 5000) throw new BadRequestException('余额核对范围超过 5000 条');
      const roomIds = rooms.map(r => r.id);
      const [accounts, ledgers, missing, orphanCounts] = await Promise.all([
        tx.prepayAccount.findMany({ where: { roomId: { in: roomIds } }, take: 5001, select: { id: true, roomId: true, balanceCache: true } }),
        tx.depositLedger.findMany({ where: buildingId ? { OR: [{ contract: { buildingId } }, { roomId: { in: roomIds } }] } : {}, take: 5001, select: { id: true, roomId: true, contractId: true, balance: true, contract: { select: { buildingId: true, roomId: true } } } }),
        tx.bill.findMany({ take: 5001, where: { billType: 'DEPOSIT', OR: [{ paidAmount: { gt: 0 } }, { paymentRecords: { some: { status: { in: ['CONFIRMED', 'VOIDED'] }, amount: { gt: 0 } } } }], contract: { ...(buildingId ? { buildingId } : {}), depositLedger: null } }, select: { id: true, contractId: true, contract: { select: { roomId: true, buildingId: true, room: { select: { buildingId: true } } } } } }),
        tx.$queryRaw<Array<{ prepay: bigint; deposit: bigint }>>`SELECT (SELECT count(*) FROM prepay_accounts a LEFT JOIN rooms r ON r.id = a."roomId" WHERE r.id IS NULL) AS prepay, (SELECT count(*) FROM deposit_ledgers d JOIN contracts c ON c.id = d."contractId" LEFT JOIN rooms r ON r.id = d."roomId" WHERE r.id IS NULL OR d."roomId" <> c."roomId" OR r."buildingId" <> c."buildingId") AS deposit`,
      ]);
      if (rooms.length + accounts.length + ledgers.length + missing.length > 5000) throw new BadRequestException('余额核对范围超过 5000 条');
      const [prepayMovements, depositMovements] = await Promise.all([
        tx.prepayTransaction.findMany({ where: { accountId: { in: accounts.map(a => a.id) } }, take: 5001, orderBy: { createdAt: 'asc' }, select: { accountId: true, id: true, type: true, amount: true, balanceAfter: true, createdAt: true, relatedId: true, relatedType: true } }),
        tx.depositTransaction.findMany({ where: { ledgerId: { in: ledgers.map(l => l.id) } }, take: 5001, orderBy: { createdAt: 'asc' }, select: { ledgerId: true, id: true, type: true, amount: true, balanceAfter: true, createdAt: true, relatedId: true, relatedType: true } }),
      ]);
      const size = rooms.length + accounts.length + ledgers.length + missing.length + prepayMovements.length + depositMovements.length;
      if (size > 5000) throw new BadRequestException('余额核对范围超过 5000 条');
      const roomBuildings = new Map(rooms.map(r => [r.id, r.buildingId]));
      const unassignedPrepayCount = Number(orphanCounts[0].prepay); const unassignedDepositCount = Number(orphanCounts[0].deposit);
      if (!Number.isSafeInteger(unassignedPrepayCount) || !Number.isSafeInteger(unassignedDepositCount)) throw new BadRequestException('归属异常数量超出安全整数范围');
      const deposit: BalanceItemDto[] = []; const prepay: BalanceItemDto[] = [];
      for (const a of accounts) {
        const owner = roomBuildings.get(a.roomId); if (buildingId && owner && owner !== buildingId) continue;
        const movements = prepayMovements.filter(m => m.accountId === a.id);
        const check = verifyBalance('prepay', a.balanceCache, movements);
        const reasons = [...check.reasons];
        if (!owner) reasons.push('账户房间无法确定当前楼栋');
        prepay.push({ id: a.id, contractId: null, roomId: a.roomId, balance: a.balanceCache, movementTotal: check.total, arithmetic: check.arithmetic, reasonCodes: [...check.codes, ...(!owner ? ['OWNERSHIP_UNKNOWN'] : [])], inScope: !!owner && (!buildingId || owner === buildingId), reasons, movements });
      }
      for (const l of ledgers) {
        const owner = roomBuildings.get(l.roomId); if (buildingId && l.contract.buildingId !== buildingId && owner && owner !== buildingId) continue;
        const movements = depositMovements.filter(m => m.ledgerId === l.id);
        const check = verifyBalance('deposit', l.balance, movements);
        const reasons = [...check.reasons];
        if (!owner || owner !== l.contract.buildingId || l.roomId !== l.contract.roomId) reasons.push('台账、合同或房间的当前归属不一致');
        deposit.push({ id: l.id, contractId: l.contractId, roomId: l.roomId, balance: l.balance, movementTotal: check.total, arithmetic: check.arithmetic, reasonCodes: [...check.codes, ...(!owner || owner !== l.contract.buildingId || l.roomId !== l.contract.roomId ? ['OWNERSHIP_UNKNOWN'] : [])], inScope: !!owner && (!buildingId || owner === buildingId) && owner === l.contract.buildingId && l.roomId === l.contract.roomId, reasons, movements });
      }
      for (const b of missing) {
        const consistent = b.contract.buildingId === b.contract.room.buildingId;
        deposit.push({ id: b.id, contractId: b.contractId, roomId: b.contract.roomId, balance: null, movementTotal: null, arithmetic: 'unknown', reasonCodes: ['MISSING_LEDGER', ...(!consistent ? ['OWNERSHIP_UNKNOWN'] : [])], inScope: consistent, reasons: ['押金账单已有收款但缺少台账', ...(!consistent ? ['合同与房间楼栋归属不一致'] : [])], movements: [] });
      }
      const category = (items: BalanceItemDto[]) => {
        items.sort((a, b) => a.id.localeCompare(b.id));
        const bookSubtotal = items.reduce((sum, item) => { const next = sum + (item.inScope ? (item.balance ?? 0) : 0); if (!Number.isSafeInteger(next)) throw new BadRequestException('余额合计超出安全整数范围'); return next; }, 0);
        return { items, bookSubtotal, unknownCount: items.length, verifiedTotal: null };
      };
      return { buildingId: buildingId ?? null, capturedAt, unassignedPrepayCount, unassignedDepositCount, deposit: category(deposit), prepay: category(prepay), limitations: ['仅反映查询时当前归属与余额，非月末或历史负债；未开预付账户不是异常。', '缺押金台账仅检查已有收款的押金账单；无法确认的历史合同不在检查范围。', '历史流水完整性无法证明，账面小计不等于完整核实合计；全局无法归属记录数量另列，未计入楼栋账面小计。'] };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async unassignedPrepay(): Promise<UnassignedPrepayResponseDto> {
    return this.prisma.$transaction(async tx => {
      const capturedAt = this.clock.now();
      const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT a.id FROM prepay_accounts a LEFT JOIN rooms r ON r.id = a."roomId" WHERE r.id IS NULL ORDER BY a.id LIMIT 5001`;
      if (ids.length > 5000) throw new BadRequestException('无房间归属预付账户超过 5000 条');
      const accounts = await tx.prepayAccount.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: { id: true, roomId: true, balanceCache: true } });
      const movements = await tx.prepayTransaction.findMany({ where: { accountId: { in: ids.map(row => row.id) } }, take: 5001, orderBy: { createdAt: 'asc' }, select: { accountId: true, id: true, type: true, amount: true, balanceAfter: true, createdAt: true, relatedId: true, relatedType: true } });
      if (accounts.length + movements.length > 5000) throw new BadRequestException('无房间归属预付明细超过 5000 条');
      const items: BalanceItemDto[] = accounts.map(a => {
        const rows = movements.filter(m => m.accountId === a.id); const check = verifyBalance('prepay', a.balanceCache, rows);
        return { id: a.id, roomId: a.roomId, contractId: null, balance: a.balanceCache, movementTotal: check.total, arithmetic: check.arithmetic, inScope: false, reasonCodes: [...check.codes, 'OWNERSHIP_UNKNOWN'], reasons: [...check.reasons, '账户房间无法确定当前楼栋'], movements: rows };
      });
      items.sort((a, b) => a.id.localeCompare(b.id));
      return { capturedAt, items };
    }, { isolationLevel: 'RepeatableRead' });
  }

  /** 依 period（+自定义区间）解析出 [start, end) */
  resolveRange(query: QueryStatisticsDto): PeriodRange {
    const today = this.clock.todayUtc();

    if (query.period === 'CUSTOM') {
      if (!query.startDate || !query.endDate) {
        // 缺参数时回退为当月，避免 500
        return this.monthRange(today);
      }
      const start = this.clock.parseDateOnly(query.startDate);
      const endDay = this.clock.parseDateOnly(query.endDate);
      if (!start || !endDay) {
        return this.monthRange(today);
      }
      // 自定义区间按业务日闭区间：[start 00:00, end 23:59:59.999]
      return { start, end: new Date(this.clock.addDays(endDay, 1).getTime() - 1) };
    }

    if (query.period === 'QUARTER') {
      return { start: this.clock.startOfQuarter(today), end: this.clock.endOfQuarter(today) };
    }

    if (query.period === 'YEAR') {
      return { start: this.clock.startOfYear(today), end: this.clock.endOfYear(today) };
    }

    return this.monthRange(today);
  }

  private monthRange(day: Date): PeriodRange {
    return { start: this.clock.startOfMonth(day), end: this.clock.endOfMonth(day) };
  }

  /** 统计总览 + 按空间维度分组 */
  async overview(query: QueryStatisticsDto) {
    const range = this.resolveRange(query);
    const roomWhere: Record<string, unknown> = {};
    if (query.buildingId) roomWhere.buildingId = query.buildingId;

    const [rooms, payments, bills, maintenance] = await Promise.all([
      this.prisma.room.findMany({
        where: roomWhere,
        select: { id: true, floor: true, roomNumber: true },
      }),
      this.prisma.paymentRecord.findMany({
        where: {
          paidAt: { gte: range.start, lte: range.end },
          ...(query.buildingId ? { bill: { contract: { buildingId: query.buildingId } } } : {}),
        },
        select: { amount: true, bill: { select: { billType: true } } },
      }),
      this.prisma.bill.findMany({
        where: {
          dueDate: { gte: range.start, lte: range.end },
          // 已取消的账单不计入出账额（T207）：否则 collectionRate 的分母被灌水，
          // 且与 dashboard/management-summary 明确使用 status:{not:'CANCELLED'} 的口径互相矛盾
          status: { not: 'CANCELLED' },
          ...(query.buildingId ? { contract: { buildingId: query.buildingId } } : {}),
        },
        select: { amount: true, billType: true, status: true, isOverdue: true },
      }),
      this.prisma.maintenanceRequest.count({
        where: {
          createdAt: { gte: range.start, lte: range.end },
          ...(query.buildingId ? { room: { buildingId: query.buildingId } } : {}),
        },
      }),
    ]);

    // 占用房间：按「统计区间的末端」计算（T207 修正）。
    // 原实现只查 status='ACTIVE'（当下的状态），把它用在历史区间报表上会串台：
    // 查 1 月报表却返回今天的占用数。现在改用合同有效期覆盖该时刻：
    // 区间末端若在未来（本月/本季报表），以「当前时刻」为准，避免出现前瞻性的空档。
    const asOf = range.end.getTime() > this.clock.now().getTime() ? this.clock.now() : range.end;
    const occupiedIds = new Set(
      (
        await this.prisma.contract.findMany({
          where: {
            status: { in: ['ACTIVE', 'EXPIRED', 'RENEWED'] },
            startDate: { lte: asOf },
            endDate: { gte: asOf },
            roomId: { in: rooms.map((r) => r.id) },
          },
          select: { roomId: true },
        })
      ).map((c) => c.roomId),
    );

    const rentPaid = sumAmounts(
      payments.filter((p) => p.bill.billType === 'RENT'),
      (p) => p.amount,
    );
    const utilityPaid = sumAmounts(
      payments.filter((p) => p.bill.billType === 'UTILITY'),
      (p) => p.amount,
    );
    const rentBilled = sumAmounts(
      bills.filter((b) => b.billType === 'RENT'),
      (b) => b.amount,
    );
    const utilityBilled = sumAmounts(
      bills.filter((b) => b.billType === 'UTILITY'),
      (b) => b.amount,
    );
    const overdueCount = bills.filter((b) => b.isOverdue).length;

    const total = rooms.length;
    const occupied = rooms.filter((r) => occupiedIds.has(r.id)).length;

    const summary = {
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      period: query.period ?? 'MONTH',
      rentBilled,
      rentPaid,
      utilityBilled,
      utilityPaid,
      totalBilled: rentBilled + utilityBilled,
      totalPaid: rentPaid + utilityPaid,
      collectionRate: collectionRate(rentBilled + utilityBilled, rentPaid + utilityPaid),
      overdueCount,
      maintenanceCount: maintenance,
      roomTotal: total,
      roomOccupied: occupied,
      occupancyRate: occupancyRate(occupied, total),
    };

    // 空间维度：整楼（单组）或按楼层分组
    if (query.dimension === 'FLOOR') {
      const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
      const byFloor = floors.map((floor) => {
        const floorRooms = rooms.filter((r) => r.floor === floor);
        const floorOccupied = floorRooms.filter((r) => occupiedIds.has(r.id)).length;
        return {
          floor,
          roomTotal: floorRooms.length,
          roomOccupied: floorOccupied,
          occupancyRate: occupancyRate(floorOccupied, floorRooms.length),
        };
      });
      return { summary, dimension: 'FLOOR', byFloor };
    }

    return { summary, dimension: 'BUILDING', byFloor: [] };
  }
}
