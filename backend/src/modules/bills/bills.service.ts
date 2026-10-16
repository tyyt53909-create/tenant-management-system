import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { LateFeeUtil, LateFeeRule } from './utils/late-fee.util.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';

const BILL_TYPE_LABEL: Record<string, string> = {
  RENT: '租金',
  DEPOSIT: '押金',
  UTILITY: '水电费',
  MAINTENANCE: '维修费',
  CLEANING: '保洁费',
  OTHER: '其他',
};

const BILL_STATUS_LABEL: Record<string, string> = {
  PENDING: '待支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
  OVERDUE: '已逾期',
  CANCELLED: '已取消',
};

/**
 * 由账单的滞纳金记录汇总出列表展示所需的摘要（导出以便单测）。
 *
 * 口径与前端原「逐行拉取明细」的展示保持一致：
 * - amount：已确认合计；未确认时为 null（前端据此只展示建议值）
 * - suggestedAmount：最新一条的系统建议值
 * - settledAmount / pendingSettled：已核销 / 确认额减去已核销
 * - status：none（无记录）/ suggested（未确认）/ confirmed（已确认未结清）/ settled（已结清）
 */
export function summarizeLateFees(
  fees: Array<{
    suggestedAmount: number;
    confirmedAmount: number | null;
    settledAmount: number | null;
    overdueDays: number;
    confirmedAt: Date | null;
    settledAt: Date | null;
  }>,
) {
  if (!fees || fees.length === 0) {
    return {
      count: 0,
      status: 'none' as const,
      amount: null,
      suggestedAmount: 0,
      settledAmount: 0,
      pendingSettled: 0,
      overdueDays: 0,
    };
  }

  const latest = fees[0];
  const confirmed = fees.filter((f) => f.confirmedAmount !== null);
  const confirmedTotal = confirmed.reduce((sum, f) => sum + (f.confirmedAmount ?? 0), 0);
  const settledTotal = confirmed.reduce((sum, f) => sum + (f.settledAmount ?? 0), 0);

  const allSettled =
    confirmed.length > 0 &&
    confirmed.every((f) => f.settledAt !== null) &&
    settledTotal >= confirmedTotal;

  let status: 'suggested' | 'confirmed' | 'settled';
  if (allSettled) status = 'settled';
  else if (confirmed.length > 0) status = 'confirmed';
  else status = 'suggested';

  return {
    count: fees.length,
    status,
    amount: confirmed.length > 0 ? confirmedTotal : null,
    suggestedAmount: latest.suggestedAmount,
    settledAmount: settledTotal,
    pendingSettled: Math.max(confirmedTotal - settledTotal, 0),
    overdueDays: latest.overdueDays,
  };
}

@Injectable()
export class BillsService {
  private readonly payments: PaymentProvider;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PAYMENT_PROVIDER) payments?: PaymentProvider,
  ) {
    this.payments = payments ?? new OfflinePaymentProvider();
  }

  async create(dto: CreateBillDto) {
    // 验证合同存在
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
    });

    if (!contract) {
      throw new BadRequestException('合同不存在');
    }

    // 生成账单编号
    const billNumber = `B${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    return this.prisma.bill.create({
      data: {
        contractId: dto.contractId,
        billNumber,
        billType: dto.billType as any,
        period: dto.period,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        snapshot: dto.snapshot || {},
      },
    });
  }

  async findAll(query: QueryBillsDto) {
    const { page = 1, limit = 20, status, billType, contractId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (billType) where.billType = billType;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: {
            include: {
              tenant: { select: { name: true } },
              room: { select: { roomNumber: true } },
            },
          },
          // 列表直接带上滞纳金摘要，避免前端对当前页每行再发一次
          // GET /bills/:id/late-fees（原为 20 次/页的 N+1，见 docs/09 第 24 条）
          lateFees: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              suggestedAmount: true,
              confirmedAmount: true,
              settledAmount: true,
              overdueDays: true,
              confirmedAt: true,
              settledAt: true,
            },
          },
        },
      }),
      this.prisma.bill.count({ where }),
    ]);

    return {
      data: data.map((bill) => {
        const { lateFees, ...rest } = bill as typeof bill & { lateFees: any[] };
        return { ...rest, lateFeeSummary: summarizeLateFees(lateFees) };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: true,
            room: { include: { building: true } },
          },
        },
        paymentRecords: true,
        // 管理者可见完整滞纳金记录（含计算过程）
        lateFees: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return bill;
  }

  async update(id: string, dto: UpdateBillDto) {
    const bill = await this.prisma.bill.findUnique({ where: { id } });
    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    const updateData: any = {};
    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.paidAmount !== undefined) updateData.paidAmount = dto.paidAmount;
    if (dto.status) updateData.status = dto.status;
    if (dto.dueDate) updateData.dueDate = new Date(dto.dueDate);

    return this.prisma.bill.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id } });
    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    await this.prisma.bill.delete({ where: { id } });
    return { message: '账单已删除' };
  }

  // 租客查看自己的账单
  async findByTenant(tenantId: string, query: QueryBillsDto) {
    const { page = 1, limit = 20, status, billType } = query;
    const skip = (page - 1) * limit;

    // 防御：tenantId 缺失时绝不能退化为「不过滤」。
    // Prisma 会把 { tenantId: undefined } 当作无此条件，从而返回全库数据。
    if (!tenantId) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    const where: any = {
      contract: {
        tenantId,
      },
    };
    if (status) where.status = status;
    if (billType) where.billType = billType;

    const [data, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contract: {
            include: {
              room: { select: { roomNumber: true } },
            },
          },
        },
      }),
      this.prisma.bill.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 租客查看单个账单（需验证归属）
  async findOneForTenant(id: string, tenantId: string) {
    // 防御：无租客身份一律按不存在处理（越权不暴露存在性）
    if (!tenantId) {
      throw new NotFoundException('账单不存在');
    }

    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        contract: {
          include: {
            tenant: true,
            room: true,
          },
        },
        paymentRecords: true,
        // 租客仅可见已确认的最终金额（docs/03-权限矩阵.md：不暴露建议值与计算细节）
        lateFees: {
          where: { confirmedAmount: { not: null } },
          select: { id: true, confirmedAmount: true, confirmedAt: true, settledAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    // 验证账单是否属于该租客
    if (bill.contract.tenantId !== tenantId) {
      throw new NotFoundException('账单不存在');
    }

    return bill;
  }

  /**
   * 登记收款（docs/04-状态机.md §3.4、T141）
   * - 仅 PENDING / PARTIAL / OVERDUE 可收款（PAID / CANCELLED 不可逆）
   * - 收款上限 = 账单未缴金额 + 未核销滞纳金合计（超出 400）
   * - 分配顺序：先入账单本金，余额按确认时间先后核销滞纳金（支持部分核销）
   * - 状态：账单全额缴清且滞纳金全部核销才 PAID，否则 PARTIAL
   * - 交易号在同一账单内幂等（应用层 + 数据库唯一索引双重保障）
   */
  async addPayment(billId: string, dto: CreatePaymentDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 悲观行锁：并发收款时串行化锁定当前账单，杜绝并发超收与状态脏写覆盖
      try {
        if (typeof (tx as any).$executeRawUnsafe === 'function') {
          await (tx as any).$executeRawUnsafe(`SELECT id FROM bills WHERE id = $1 FOR UPDATE`, billId);
        }
      } catch {
        // 兼容单元测试 mock 或无原生 SQL 执行环境
      }

      const bill = await tx.bill.findUnique({ where: { id: billId } });

      if (!bill) {
        throw new NotFoundException('账单不存在');
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可收款`);
      }

      // 已确认未核销的滞纳金（按确认先后核销）
      const unsettledFees = await tx.lateFee.findMany({
        where: { billId, confirmedAmount: { not: null } },
        orderBy: { createdAt: 'asc' },
      });

      const outstandingFees = unsettledFees.reduce(
        (sum, fee) => sum + this.lateFeeOutstanding(fee),
        0,
      );

      const remaining = bill.amount - bill.paidAmount;
      const maxCollectable = remaining + outstandingFees;

      if (dto.amount > maxCollectable) {
        throw new BadRequestException(
          `收款金额不能超过未缴金额（账单未缴 ${remaining} 分 + 未核销滞纳金 ${outstandingFees} 分）`,
        );
      }

      if (dto.transactionNumber) {
        const duplicated = await tx.paymentRecord.findFirst({
          where: { billId, transactionNumber: dto.transactionNumber },
        });

        if (duplicated) {
          throw new ConflictException('该交易号已登记过，请勿重复收款');
        }
      }

      await this.payments.createOrder({
        billId,
        amount: dto.amount,
        paymentMethod: dto.paymentMethod,
        description: `账单 ${billId}`,
      });

      const payment = await tx.paymentRecord.create({
        data: {
          billId,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod as any,
          transactionNumber: dto.transactionNumber,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          confirmedBy: operatorId,
          notes: dto.notes,
        },
      });

      // 先入账单，余额核销滞纳金
      const billPortion = Math.min(dto.amount, remaining);
      let feePortion = dto.amount - billPortion;
      const now = new Date();

      const settledFees: unknown[] = [];
      for (const fee of unsettledFees) {
        if (feePortion <= 0) break;

        const feeOutstanding = this.lateFeeOutstanding(fee);
        if (feeOutstanding <= 0) continue;

        const applied = Math.min(feePortion, feeOutstanding);
        feePortion -= applied;

        const newSettledAmount = (fee.settledAmount ?? 0) + applied;
        const fullySettled = newSettledAmount >= (fee.confirmedAmount ?? 0);

        settledFees.push(
          await tx.lateFee.update({
            where: { id: fee.id },
            data: {
              settledAmount: newSettledAmount,
              ...(fullySettled ? { settledAt: now, settledBy: operatorId } : {}),
            },
          }),
        );
      }

      const newPaidAmount = bill.paidAmount + billPortion;
      const outstandingAfter = outstandingFees - (dto.amount - billPortion);
      const fullySettledAll = newPaidAmount >= bill.amount && outstandingAfter <= 0;
      const newStatus = fullySettledAll ? 'PAID' : 'PARTIAL';

      const updatedBill = await tx.bill.update({
        where: { id: billId },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
        },
      });

      return { payment, bill: updatedBill, lateFees: settledFees };
    });
  }

  /** 滞纳金未核销余额（分） */
  private lateFeeOutstanding(fee: { confirmedAmount: number | null; settledAmount: number | null }) {
    return Math.max(0, (fee.confirmedAmount ?? 0) - (fee.settledAmount ?? 0));
  }

  /**
   * 账单收款流水（按收款时间倒序）
   */
  async findPayments(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return this.prisma.paymentRecord.findMany({
      where: { billId },
      orderBy: { paidAt: 'desc' },
    });
  }

  /**
   * 添加 / 刷新滞纳金（docs/04-状态机.md §3.4、docs/02-数据模型.md §2.9）
   * - 仅对已逾期（到期日 < 今日）且未缴清的账单生效
   * - 不带 confirmedAmount：生成或刷新「建议值」（同一账单只保留一条未确认建议，重复调用不重复建单）
   * - 带 confirmedAmount：管理者确认入账（金额可调整），确认后不可重复确认（409）
   */
  async addLateFee(billId: string, dto: CreateLateFeeDto, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id: billId },
        include: { contract: { select: { lateFeeRule: true } } },
      });

      if (!bill) {
        throw new NotFoundException('账单不存在');
      }

      if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
        throw new BadRequestException(`账单为 ${bill.status} 状态，不可添加滞纳金`);
      }

      const overdueDays = LateFeeUtil.overdueDays(bill.dueDate);
      if (overdueDays <= 0) {
        throw new BadRequestException('账单尚未逾期，无需计算滞纳金');
      }

      const baseAmount = bill.amount - bill.paidAmount;
      if (baseAmount <= 0) {
        throw new BadRequestException('账单已缴清，无需计算滞纳金');
      }

      const result = LateFeeUtil.calculate(
        (bill.contract?.lateFeeRule ?? {}) as LateFeeRule,
        baseAmount,
        overdueDays,
      );

      const calculation = {
        rule: result.rule,
        overdueDays: result.overdueDays,
        effectiveDays: result.effectiveDays,
        baseAmount: result.baseAmount,
        rawAmount: result.rawAmount,
        capped: result.capped,
      };

      const pending = await tx.lateFee.findFirst({
        where: { billId, confirmedAmount: null },
        orderBy: { createdAt: 'desc' },
      });

      if (dto.confirmedAmount !== undefined) {
        // 管理者确认（可调整金额）
        if (!pending) {
          const alreadyConfirmed = await tx.lateFee.findFirst({
            where: { billId, confirmedAmount: { not: null } },
          });
          if (alreadyConfirmed) {
            throw new ConflictException('该账单滞纳金已确认，请勿重复操作');
          }
        }

        const now = new Date();
        const confirmData = {
          suggestedAmount: result.amount,
          overdueDays: result.overdueDays,
          calculation,
          confirmedAmount: dto.confirmedAmount,
          confirmedAt: now,
          confirmedBy: operatorId,
          // 减免为 0：无应收，直接视为结清（不产生未核销余额）
          ...(dto.confirmedAmount === 0
            ? { settledAmount: 0, settledAt: now, settledBy: operatorId }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        };

        return pending
          ? tx.lateFee.update({ where: { id: pending.id }, data: confirmData })
          : tx.lateFee.create({ data: { billId, ...confirmData } });
      }

      // 仅生成 / 刷新建议值
      if (pending) {
        return tx.lateFee.update({
          where: { id: pending.id },
          data: {
            suggestedAmount: result.amount,
            overdueDays: result.overdueDays,
            calculation,
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          },
        });
      }

      const alreadyConfirmed = await tx.lateFee.findFirst({
        where: { billId, confirmedAmount: { not: null } },
      });
      if (alreadyConfirmed) {
        throw new ConflictException('该账单滞纳金已确认，请勿重复操作');
      }

      return tx.lateFee.create({
        data: {
          billId,
          suggestedAmount: result.amount,
          overdueDays: result.overdueDays,
          calculation,
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    });
  }

  /**
   * 滞纳金记录（含计算过程，仅管理者）
   */
  async findLateFees(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    return this.prisma.lateFee.findMany({
      where: { billId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 账单数据 CSV 导出
   */
  async exportBills(query: any) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.billType) where.billType = query.billType;
    if (query.contractId) where.contractId = query.contractId;
    if (query.buildingId) {
      where.contract = { room: { buildingId: query.buildingId } };
    }
    if (query.startDate || query.endDate) {
      where.dueDate = {};
      if (query.startDate) where.dueDate.gte = new Date(query.startDate);
      if (query.endDate) where.dueDate.lte = new Date(query.endDate);
    }

    const bills = await this.prisma.bill.findMany({
      where,
      include: {
        contract: {
          include: {
            tenant: { select: { name: true, phone: true } },
            room: { select: { roomNumber: true } },
          },
        },
        lateFees: { select: { confirmedAmount: true, settledAmount: true, suggestedAmount: true } },
      },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
    });

    const columns: CsvColumn[] = [
      { header: '账单编号', key: 'billNumber' },
      { header: '房间号', formatter: (b) => b.contract?.room?.roomNumber || '' },
      { header: '租客姓名', formatter: (b) => b.contract?.tenant?.name || '' },
      { header: '租客手机', formatter: (b) => b.contract?.tenant?.phone || '' },
      { header: '账单类型', formatter: (b) => BILL_TYPE_LABEL[b.billType] || b.billType },
      { header: '账期', key: 'period' },
      { header: '应付金额(元)', formatter: (b) => centsToYuanString(b.amount) },
      { header: '已付金额(元)', formatter: (b) => centsToYuanString(b.paidAmount) },
      { header: '未付本金(元)', formatter: (b) => centsToYuanString(Math.max(0, b.amount - b.paidAmount)) },
      {
        header: '确认滞纳金(元)',
        formatter: (b) => {
          const summary = summarizeLateFees(b.lateFees || []);
          return summary.amount !== null ? centsToYuanString(summary.amount) : '0.00';
        },
      },
      { header: '到期日期', formatter: (b) => (b.dueDate ? new Date(b.dueDate).toISOString().slice(0, 10) : '') },
      { header: '状态', formatter: (b) => BILL_STATUS_LABEL[b.status] || b.status },
      { header: '创建时间', formatter: (b) => (b.createdAt ? new Date(b.createdAt).toLocaleString('zh-CN') : '') },
    ];

    return generateCsv(columns, bills);
  }

  /**
   * 电子收款收据单据数据聚合（支持租客归属防越权）
   */
  async getReceipt(billId: string, tenantId?: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          include: {
            tenant: true,
            room: {
              include: {
                building: true,
              },
            },
          },
        },
        paymentRecords: {
          orderBy: { paidAt: 'desc' },
        },
        lateFees: {
          where: { confirmedAmount: { not: null } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    if (tenantId && (!bill.contract || bill.contract.tenantId !== tenantId)) {
      throw new NotFoundException('收据不存在');
    }

    const lateFeeSummary = summarizeLateFees(bill.lateFees || []);
    const confirmedLateFee = lateFeeSummary.amount ?? 0;
    const totalPayable = bill.amount + confirmedLateFee;
    const paymentRecords = bill.paymentRecords || [];
    const totalPaid = paymentRecords.reduce((sum, p) => sum + p.amount, 0);
    const unpaid = Math.max(0, totalPayable - totalPaid);

    return {
      receiptNumber: `RCP-${bill.billNumber}`,
      billId: bill.id,
      billNumber: bill.billNumber,
      payerName: bill.contract?.tenant?.name || '租客',
      payerPhone: bill.contract?.tenant?.phone || '',
      roomNumber: bill.contract?.room?.roomNumber || '',
      buildingName: bill.contract?.room?.building?.name || '',
      period: bill.period,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      principalAmount: bill.amount,
      paidAmount: bill.paidAmount,
      confirmedLateFee,
      totalPayable,
      totalPaid,
      unpaid,
      amountInChinese: centsToChineseRMB(totalPaid > 0 ? totalPaid : bill.paidAmount),
      payments: paymentRecords.map((p) => ({
        id: p.id,
        amount: p.amount,
        amountYuan: centsToYuanString(p.amount),
        paymentMethod: p.paymentMethod,
        transactionNumber: p.transactionNumber,
        paidAt: p.paidAt,
        notes: p.notes,
      })),
      issuedAt: new Date(),
    };
  }

  /**
   * 单据快速识别与智能匹配（支持粘贴文本、微信单据码、单号识别）
   */
  async recognizeVoucher(rawInput: string) {
    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
      throw new BadRequestException('请提供需要识别的单据内容或单号');
    }

    const trimmed = rawInput.trim();
    let extractedBillNo = '';
    let extractedAmountCents: number | null = null;

    // 1. 优先匹配标准化识别码：[VOUCHER:BILL-202610-001:250000]
    const voucherTagMatch = trimmed.match(/(?:\[VOUCHER:|VOUCHER:)([A-Za-z0-9_-]+)(?::(\d+))?\]?/i);
    if (voucherTagMatch) {
      extractedBillNo = voucherTagMatch[1];
      if (voucherTagMatch[2]) {
        extractedAmountCents = parseInt(voucherTagMatch[2], 10);
      }
    }

    // 2. 匹配文本中的账单编号：账单编号：BILL-xxx 或 单号：B-xxx
    if (!extractedBillNo) {
      const billNoMatch = trimmed.match(/(?:账单编号|单据编号|单号)[：:\s]*([A-Za-z0-9_-]+)/i);
      if (billNoMatch) {
        extractedBillNo = billNoMatch[1];
      }
    }

    // 3. 若整段文字本身就是单号
    if (!extractedBillNo) {
      const directMatch = trimmed.match(/^(?:BILL-[\w-]+|B\d{6,}[\w-]*|c[a-z0-9]{20,})$/i);
      if (directMatch) {
        extractedBillNo = directMatch[0];
      }
    }

    // 4. 尝试提取金额（若尚未从标签提取）
    if (extractedAmountCents === null) {
      const moneyMatch = trimmed.match(/(?:应缴金额|金额|待缴|¥|￥)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/);
      if (moneyMatch) {
        extractedAmountCents = Math.round(parseFloat(moneyMatch[1]) * 100);
      }
    }

    if (!extractedBillNo) {
      throw new BadRequestException('未能从输入内容中识别到有效的账单编号');
    }

    // 5. 查询账单
    const bill = await this.prisma.bill.findFirst({
      where: {
        OR: [
          { billNumber: extractedBillNo },
          { id: extractedBillNo },
        ],
      },
      include: {
        contract: {
          include: {
            tenant: true,
            room: { include: { building: true } },
          },
        },
        paymentRecords: { orderBy: { paidAt: 'desc' }, take: 10 },
        lateFees: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!bill) {
      throw new NotFoundException(`未能找到编号为「${extractedBillNo}」的账单`);
    }

    // 6. 金额计算
    const unpaidAmount = Math.max(0, bill.amount - bill.paidAmount);
    const unsettledFees = (bill.lateFees || []).filter((f) => (f.confirmedAmount ?? 0) > (f.settledAmount ?? 0));
    const outstandingLateFees = unsettledFees.reduce((sum, f) => sum + this.lateFeeOutstanding(f), 0);
    const totalRemaining = unpaidAmount + outstandingLateFees;

    // 金额比对：只认当前待收合计或未缴本金。原账单金额在已有收款后不再算匹配，避免旧单据被当成可全额入账。
    let amountMatchStatus = 'UNKNOWN'; // MATCHED | MISMATCH | UNKNOWN
    if (extractedAmountCents !== null) {
      if (extractedAmountCents === totalRemaining || extractedAmountCents === unpaidAmount) {
        amountMatchStatus = 'MATCHED';
      } else {
        amountMatchStatus = 'MISMATCH';
      }
    }

    return {
      success: true,
      matchedBy: extractedBillNo,
      billId: bill.id,
      billNumber: bill.billNumber,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      period: bill.period,
      status: bill.status,
      isPaid: bill.status === 'PAID',
      isCancelled: bill.status === 'CANCELLED',
      dueDate: bill.dueDate,
      amount: bill.amount,
      amountYuan: centsToYuanString(bill.amount),
      paidAmount: bill.paidAmount,
      paidAmountYuan: centsToYuanString(bill.paidAmount),
      unpaidAmount,
      unpaidAmountYuan: centsToYuanString(unpaidAmount),
      outstandingLateFees,
      outstandingLateFeesYuan: centsToYuanString(outstandingLateFees),
      suggestedAmount: totalRemaining,
      suggestedAmountYuan: centsToYuanString(totalRemaining),
      extractedAmountCents,
      extractedAmountYuan: extractedAmountCents !== null ? centsToYuanString(extractedAmountCents) : null,
      amountMatchStatus,
      tenant: {
        id: bill.contract?.tenant?.id || '',
        name: bill.contract?.tenant?.name || '租客',
        phone: bill.contract?.tenant?.phone || '',
      },
      room: {
        id: bill.contract?.room?.id || '',
        roomNumber: bill.contract?.room?.roomNumber || '—',
        buildingName: bill.contract?.room?.building?.name || '',
      },
      recentPayments: bill.paymentRecords.map((p) => ({
        id: p.id,
        amount: p.amount,
        amountYuan: centsToYuanString(p.amount),
        paymentMethod: p.paymentMethod,
        paidAt: p.paidAt,
      })),
    };
  }
}
