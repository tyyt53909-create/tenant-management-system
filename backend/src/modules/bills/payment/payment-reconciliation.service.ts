import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BillPaymentService } from '../bill-payment.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type TradeBillItem,
} from './payment-provider.js';
import {
  QueryReconciliationBatchesDto,
  ResolveDiscrepancyDto,
  DiscrepancyResolveAction,
} from '../dto/reconciliation.dto.js';
import { PaymentMethod } from '../dto/create-payment.dto.js';
import { randomHex } from '../../../common/utils/secure-random.js';

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billPaymentService: BillPaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * 触发日终对账比对（管理端 / 定时任务）
   */
  async runReconciliation(billDateStr: string, operatorId: string) {
    const start = new Date(`${billDateStr}T00:00:00+08:00`);
    const end = new Date(`${billDateStr}T23:59:59.999+08:00`);
    const batchNumber = `REC_${billDateStr.replace(/-/g, '')}_${randomHex(3).toUpperCase()}`;

    // 1. 获取微信日终对账流水
    let wechatBills: TradeBillItem[] = [];
    if (this.paymentProvider.downloadTradeBill) {
      try {
        wechatBills = await this.paymentProvider.downloadTradeBill(billDateStr);
      } catch (err: any) {
        this.logger.error(`下载微信对账单异常: ${err.message}`);
        throw new BadRequestException(`下载对账单失败: ${err.message}`);
      }
    }

    // 2. 获取系统当日微信交易流水
    const systemPayments = await this.prisma.paymentRecord.findMany({
      where: {
        paymentMethod: 'WECHAT',
        status: { in: ['CONFIRMED', 'VOIDED'] },
        paidAt: { gte: start, lte: end },
      },
      include: { bill: true },
    });

    const itemsToCreate: Array<{
      outTradeNo?: string;
      transactionId?: string;
      outRefundNo?: string;
      refundId?: string;
      wechatAmount?: number;
      systemAmount?: number;
      wechatStatus?: string;
      systemStatus?: string;
      type: 'MATCHED' | 'SYSTEM_MISSING' | 'WECHAT_MISSING' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH';
    }> = [];

    const matchedSystemPaymentIds = new Set<string>();

    // 3. 以微信侧账单为基准匹配系统记录
    for (const wxItem of wechatBills) {
      // 通过 transactionId 或 idempotencyKey 关联
      const matchedPayment = systemPayments.find((sp) => {
        if (wxItem.transactionId && sp.transactionNumber === wxItem.transactionId) {
          return true;
        }
        if (wxItem.outTradeNo && sp.idempotencyKey === `wechat_pay_${wxItem.outTradeNo}`) {
          return true;
        }
        return false;
      });

      if (matchedPayment) {
        matchedSystemPaymentIds.add(matchedPayment.id);
        const amountMatch = wxItem.totalAmount === matchedPayment.amount;

        if (!amountMatch) {
          itemsToCreate.push({
            outTradeNo: wxItem.outTradeNo,
            transactionId: wxItem.transactionId,
            wechatAmount: wxItem.totalAmount,
            systemAmount: matchedPayment.amount,
            wechatStatus: wxItem.tradeState,
            systemStatus: matchedPayment.status,
            type: 'AMOUNT_MISMATCH',
          });
        } else {
          itemsToCreate.push({
            outTradeNo: wxItem.outTradeNo,
            transactionId: wxItem.transactionId,
            wechatAmount: wxItem.totalAmount,
            systemAmount: matchedPayment.amount,
            wechatStatus: wxItem.tradeState,
            systemStatus: matchedPayment.status,
            type: 'MATCHED',
          });
        }
      } else {
        // 微信有，系统无 -> SYSTEM_MISSING（掉单）
        itemsToCreate.push({
          outTradeNo: wxItem.outTradeNo,
          transactionId: wxItem.transactionId,
          wechatAmount: wxItem.totalAmount,
          systemAmount: 0,
          wechatStatus: wxItem.tradeState,
          systemStatus: 'MISSING',
          type: 'SYSTEM_MISSING',
        });
      }
    }

    // 4. 检查系统有多余的记录 -> WECHAT_MISSING
    for (const sp of systemPayments) {
      if (!matchedSystemPaymentIds.has(sp.id)) {
        const outTradeNo = sp.idempotencyKey?.replace(/^wechat_pay_/, '') || undefined;
        itemsToCreate.push({
          outTradeNo,
          transactionId: sp.transactionNumber || undefined,
          wechatAmount: 0,
          systemAmount: sp.amount,
          wechatStatus: 'MISSING',
          systemStatus: sp.status,
          type: 'WECHAT_MISSING',
        });
      }
    }

    // 5. 汇总指标
    const totalWechatCount = wechatBills.length;
    const totalWechatAmount = wechatBills.reduce((sum, b) => sum + b.totalAmount, 0);
    const totalSystemCount = systemPayments.length;
    const totalSystemAmount = systemPayments.reduce((sum, p) => sum + p.amount, 0);

    const matchedCount = itemsToCreate.filter((i) => i.type === 'MATCHED').length;
    const discrepancyCount = itemsToCreate.filter((i) => i.type !== 'MATCHED').length;

    const batch = await this.prisma.paymentReconciliationBatch.create({
      data: {
        batchNumber,
        billDate: start,
        channel: 'WECHAT',
        totalWechatCount,
        totalWechatAmount,
        totalSystemCount,
        totalSystemAmount,
        matchedCount,
        discrepancyCount,
        status: 'COMPLETED',
        executedBy: operatorId,
        items: {
          create: itemsToCreate,
        },
      },
      include: {
        items: true,
      },
    });

    this.logger.log(
      `日终对账比对完成: 批次=${batchNumber}, 日期=${billDateStr}, 平账=${matchedCount}, 差异=${discrepancyCount}`,
    );

    return batch;
  }

  /**
   * 分页查询对账批次列表
   */
  async queryBatches(query: QueryReconciliationBatchesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.startDate || query.endDate) {
      where.billDate = {};
      if (query.startDate) where.billDate.gte = new Date(`${query.startDate}T00:00:00.000Z`);
      if (query.endDate) where.billDate.lte = new Date(`${query.endDate}T23:59:59.999Z`);
    }

    const [total, batches] = await Promise.all([
      this.prisma.paymentReconciliationBatch.count({ where }),
      this.prisma.paymentReconciliationBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { billDate: 'desc' },
      }),
    ]);

    return {
      data: batches,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 获取批次详情及明细
   */
  async getBatchDetail(id: string) {
    const batch = await this.prisma.paymentReconciliationBatch.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ resolved: 'asc' }, { type: 'asc' }],
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('对账批次不存在');
    }

    return batch;
  }

  /**
   * 差异项处理（自动补账 / 人工平账）
   */
  async resolveDiscrepancy(
    itemId: string,
    dto: ResolveDiscrepancyDto,
    operatorId: string,
  ) {
    const item = await this.prisma.paymentReconciliationItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });

    if (!item) {
      throw new NotFoundException('对账明细不存在');
    }

    if (item.resolved) {
      throw new BadRequestException('该差异项已处理，无需重复平账');
    }

    if (dto.action === DiscrepancyResolveAction.AUTO_SYNC) {
      if (item.type !== 'SYSTEM_MISSING') {
        throw new BadRequestException('仅系统漏单 (SYSTEM_MISSING) 支持自动补账');
      }

      if (!item.outTradeNo) {
        throw new BadRequestException('缺少商户订单号，无法自动补账');
      }

      // 尝试还原账单 ID（通过 mockProvider 订单缓存或查询未缴清账单）
      let billId: string | undefined;
      if ('getOrder' in this.paymentProvider) {
        const order = (this.paymentProvider as any).getOrder(item.outTradeNo);
        billId = order?.billId;
      }

      if (!billId) {
        // 尝试从 outTradeNo 或现有账单中寻找匹配
        const possibleBill = await this.prisma.bill.findFirst({
          where: {
            status: { in: ['PENDING', 'PARTIAL'] },
            amount: item.wechatAmount ?? undefined,
          },
        });
        billId = possibleBill?.id;
      }

      if (!billId) {
        throw new BadRequestException('未匹配到可自动补账的账单，请核实后走人工平账');
      }

      const idempotencyKey = `wechat_pay_${item.outTradeNo}`;
      await this.billPaymentService.addPayment(
        billId,
        {
          amount: item.wechatAmount ?? 0,
          paymentMethod: PaymentMethod.WECHAT,
          transactionNumber: item.transactionId || undefined,
          idempotencyKey,
          notes: `日终对账掉单自动补账 (${item.batch.batchNumber})`,
        },
        operatorId,
      );
    }

    const updated = await this.prisma.paymentReconciliationItem.update({
      where: { id: itemId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: operatorId,
        resolveNotes: dto.notes || (dto.action === DiscrepancyResolveAction.AUTO_SYNC ? '自动补账入账完成' : '人工确认平账'),
      },
    });

    return updated;
  }
}
