import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import type { Prisma, BillType, BillStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { LateFeeUtil, LateFeeRule } from './utils/late-fee.util.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import { randomHex } from '../../common/utils/secure-random.js';
import {
  formatBusinessDate,
  formatBusinessDateTime,
} from '../../common/business-clock/business-clock.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { isUniqueConstraintError } from '../../common/utils/prisma-error.js';
import { rentBillDedupKey } from '../../common/utils/duplicate-keys.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';
import { BillPaymentService } from './bill-payment.service.js';
import { BillLateFeeService } from './bill-late-fee.service.js';
import { BillReceiptService } from './bill-receipt.service.js';

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
  private readonly paymentService: BillPaymentService;
  private readonly lateFeeService: BillLateFeeService;
  private readonly receiptService: BillReceiptService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() paymentService?: BillPaymentService,
    @Optional() lateFeeService?: BillLateFeeService,
    @Optional() receiptService?: BillReceiptService,
    @Optional() @Inject(PAYMENT_PROVIDER) payments?: PaymentProvider,
  ) {
    const provider = payments ?? new OfflinePaymentProvider();
    this.paymentService = paymentService ?? new BillPaymentService(prisma, provider);
    this.lateFeeService = lateFeeService ?? new BillLateFeeService(prisma);
    this.receiptService = receiptService ?? new BillReceiptService(prisma);
  }

  async create(dto: CreateBillDto) {
    // 验证合同存在
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
    });

    if (!contract) {
      throw new BadRequestException('合同不存在');
    }

    // 生成账单编号：加密随机串，禁止 Math.random（AGENTS 14.4）
    const billNumber = `B${Date.now()}${randomHex(3)}`;
    const dedupKey =
      dto.billType === 'RENT'
        ? rentBillDedupKey(dto.contractId, dto.period)
        : dto.billType === 'DEPOSIT'
          ? `DEPOSIT:${dto.contractId}`
          : null;

    try {
      const bill = await this.prisma.bill.create({
        data: {
          contractId: dto.contractId,
          billNumber,
          billType: dto.billType as BillType,
          period: dto.period,
          amount: dto.amount,
          dueDate: new Date(dto.dueDate),
          snapshot: dto.snapshot ? (dto.snapshot as Prisma.InputJsonValue) : {},
          dedupKey,
        },
      });
      return { ...bill, alreadyExists: false as const };
    } catch (error) {
      if (!dedupKey || !isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await this.prisma.bill.findUnique({ where: { dedupKey } });
      if (!existing) {
        throw error;
      }
      return { ...existing, alreadyExists: true as const };
    }
  }

  async findAll(query: QueryBillsDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BillWhereInput = {};
    this.applyBillFilters(where, query);

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
        const { lateFees, ...rest } = bill as typeof bill & { lateFees: Parameters<typeof summarizeLateFees>[0] };
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

    const updateData: Prisma.BillUpdateInput = {};
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

    // FIN-06 / T265：账单是财务凭证，只能作废（status=CANCELLED），不得硬删除。
    throw new ConflictException('账单是财务凭证，只能作废（PATCH status=CANCELLED），不能删除');
  }

  // 租客查看自己的账单
  async findByTenant(tenantId: string, query: QueryBillsDto) {
    const { page = 1, limit = 20, status, billType } = query;
    const skip = (page - 1) * limit;

    // 此处 where 需按可选筛选条件增量赋值；Prisma 的联合过滤类型无法在填入普通 string 后再收窄，故保留 any（OPT-17 已注释豁免）
    const where: any = {
      contract: scopedWhere(tenantId),
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
    const scope = scopedWhere(tenantId);

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
    if (bill.contract.tenantId !== scope.tenantId) {
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
  /**
   * 登记收款（docs/04-状态机.md §3.4、T141）
   */
  async addPayment(billId: string, dto: CreatePaymentDto, operatorId: string) {
    return this.paymentService.addPayment(billId, dto, operatorId);
  }

  /**
   * 账单收款流水（按收款时间倒序）
   */
  async findPayments(billId: string) {
    return this.paymentService.findPayments(billId);
  }

  /**
   * 作废收款并生成冲正（FIN-05）
   */
  async voidPayment(billId: string, paymentId: string, operatorId: string, reason: string) {
    return this.paymentService.voidPayment(billId, paymentId, operatorId, reason);
  }

  /**
   * 添加 / 刷新滞纳金（docs/04-状态机.md §3.4、docs/02-数据模型.md §2.9）
   */
  async addLateFee(billId: string, dto: CreateLateFeeDto, operatorId: string, referenceDate?: Date) {
    return this.lateFeeService.addLateFee(billId, dto, operatorId, referenceDate);
  }

  /**
   * 滞纳金记录（含计算过程，仅管理者）
   */
  async findLateFees(billId: string) {
    return this.lateFeeService.findLateFees(billId);
  }

  /**
   * 账单数据 CSV 导出
   */
  /**
   * 账单筛选共用（FIN-04 / T272）。
   * `status=OVERDUE` 兼容旧调用：映射为 isOverdue + 未缴清状态，不再直接匹配 status。
   */
  private applyBillFilters(where: Prisma.BillWhereInput, query: Partial<QueryBillsDto>) {
    const status = query.status as string | undefined;
    if (query.overdue || status === 'OVERDUE') {
      where.isOverdue = true;
      where.status = { in: ['PENDING', 'PARTIAL'] };
    } else if (status) {
      where.status = status as BillStatus;
    }
    if (query.billType) where.billType = query.billType as BillType;
    if (query.contractId) where.contractId = query.contractId;
    // 与导出对齐：列表同样支持楼栋与账期区间筛选（T209 之前这三个参数被静默忽略）
    if (query.buildingId) {
      where.contract = { room: { buildingId: query.buildingId } };
    }
    if (query.startDate || query.endDate) {
      where.dueDate = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }
  }

  async exportBills(query: Partial<QueryBillsDto>) {
    const where: Prisma.BillWhereInput = {};
    this.applyBillFilters(where, query);

    const bills = await this.prisma.bill.findMany({
      where,
      include: {
        contract: {
          include: {
            tenant: { select: { name: true, phone: true } },
            room: { select: { roomNumber: true } },
          },
        },
        lateFees: { select: { confirmedAmount: true, settledAmount: true, suggestedAmount: true, overdueDays: true, confirmedAt: true, settledAt: true } },
      },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 5000,
    });

    type ExportBillItem = (typeof bills)[number];
    const columns: CsvColumn<ExportBillItem>[] = [
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
      {
        header: '到期日期',
        formatter: (b) => (b.dueDate ? formatBusinessDate(new Date(b.dueDate)) : ''),
      },
      { header: '状态', formatter: (b) => BILL_STATUS_LABEL[b.status] || b.status },
      {
        header: '创建时间',
        formatter: (b) => (b.createdAt ? formatBusinessDateTime(new Date(b.createdAt)) : ''),
      },
    ];

    return generateCsv(columns, bills);
  }

  /**
   * 电子收款收据单据数据聚合（支持租客归属防越权）
   */
  async getReceipt(billId: string, tenantId?: string) {
    return this.receiptService.getReceipt(billId, tenantId);
  }

  /**
   * 单据快速识别与智能匹配（支持粘贴文本、微信单据码、单号识别）
   */
  async recognizeVoucher(rawInput: string) {
    return this.receiptService.recognizeVoucher(rawInput);
  }
}
