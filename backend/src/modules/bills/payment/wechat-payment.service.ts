import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BillPaymentService } from '../bill-payment.service.js';
import {
  PAYMENT_PROVIDER,
  type JsapiPaymentParams,
  type PaymentProvider,
} from './payment-provider.js';
import { WechatJsapiPayDto, WechatPayQueryDto } from '../dto/wechat-pay.dto.js';
import { CreateWechatRefundDto, WechatRefundResponseDto } from '../dto/wechat-refund.dto.js';
import {
  WechatReconciliationQueryDto,
  WechatReconciliationResponseDto,
  WechatReconciliationDiscrepancy,
} from '../dto/wechat-reconciliation.dto.js';
import { PaymentMethod } from '../dto/create-payment.dto.js';
import { randomHex } from '../../../common/utils/secure-random.js';

@Injectable()
export class WechatPaymentService {
  private readonly logger = new Logger(WechatPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billPaymentService: BillPaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 租客发起微信支付 JSAPI 下单
   */
  async createJsapiOrder(
    billId: string,
    userId: string,
    userRole: string,
    dto?: WechatJsapiPayDto,
  ): Promise<JsapiPaymentParams> {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          select: {
            id: true,
            tenantId: true,
            tenant: { select: { id: true, userId: true } },
          },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    // 租客防越权校验：TENANT 必须是当前合同租客
    if (userRole === 'TENANT') {
      const userTenant = await this.prisma.tenant.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!userTenant || bill.contract.tenantId !== userTenant.id) {
        throw new ForbiddenException('您无权支付非本人的账单');
      }
    }

    if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
      throw new BadRequestException(`账单当前为 ${bill.status} 状态，无需支付`);
    }

    // 计算未核销滞纳金与待缴金额
    const unsettledFees = await this.prisma.lateFee.findMany({
      where: { billId, confirmedAmount: { not: null } },
    });
    const outstandingFees = unsettledFees.reduce((sum, fee) => {
      const confirmed = fee.confirmedAmount ?? 0;
      const settled = fee.settledAmount ?? 0;
      return sum + Math.max(0, confirmed - settled);
    }, 0);

    const remaining = bill.amount - bill.paidAmount + outstandingFees;
    if (remaining <= 0) {
      throw new BadRequestException('账单已无待缴金额');
    }

    const payAmount = dto?.amount ? Math.min(dto.amount, remaining) : remaining;

    // 获取当前租客的微信 openid
    const identity = await this.prisma.userIdentity.findFirst({
      where: { userId, provider: 'WECHAT_MP' },
      select: { providerUserId: true },
    });

    let openid = identity?.providerUserId;
    if (!openid) {
      // 在模拟器或开发模式下允许使用 mock openid
      const isMock =
        this.paymentProvider.name === 'wechat-mock' ||
        this.configService.get('WECHAT_PAY_MOCK') === 'true' ||
        this.configService.get('NODE_ENV') !== 'production';

      if (isMock) {
        openid = `mock_openid_${userId}`;
      } else {
        throw new BadRequestException('未检测到绑定的微信身份，请先在小程序中授权登录');
      }
    }

    // 微信商户单号 <= 32 字符
    const outTradeNo = `WP_${Date.now()}_${randomHex(4)}`;
    const attach = JSON.stringify({ billId, userId });

    if (!this.paymentProvider.createJsapiOrder) {
      throw new BadRequestException('当前支付通道不支持微信 JSAPI 线上支付');
    }

    return this.paymentProvider.createJsapiOrder({
      billId,
      amount: payAmount,
      description: `栖居生活-账单缴费(${bill.billNumber})`,
      openid,
      outTradeNo,
      attach,
    });
  }

  /**
   * 微信支付异步通知回调处理
   */
  async handleNotify(
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<{ code: string; message: string }> {
    if (!this.paymentProvider.verifyAndParseNotify) {
      throw new BadRequestException('当前支付通道不支持微信支付回调解析');
    }

    const resource = await this.paymentProvider.verifyAndParseNotify(headers, body);

    if (resource.tradeState === 'SUCCESS') {
      let billId: string | undefined;

      if (resource.attach) {
        try {
          const parsed = JSON.parse(resource.attach);
          billId = parsed.billId;
        } catch {
          // 容错
        }
      }

      // 如果 attach 无法还原，尝试通过 mockProvider 内存或已有订单还原
      if (!billId && 'getOrder' in this.paymentProvider) {
        const order = (this.paymentProvider as any).getOrder(resource.outTradeNo);
        billId = order?.billId;
      }

      if (!billId) {
        this.logger.error(`微信支付回调无法解析对应的 billId: ${JSON.stringify(resource)}`);
        throw new BadRequestException('支付通知缺少账单关联信息');
      }

      // 幂等入账
      const idempotencyKey = `wechat_pay_${resource.outTradeNo}`;
      await this.billPaymentService.addPayment(
        billId,
        {
          amount: resource.amount,
          paymentMethod: PaymentMethod.WECHAT,
          transactionNumber: resource.transactionId,
          idempotencyKey,
          notes: `微信支付线上缴费 (单号: ${resource.outTradeNo})`,
        },
        'SYSTEM_WECHAT_PAY',
      );

      this.logger.log(
        `微信支付入账成功: 账单=${billId}, 单号=${resource.outTradeNo}, 交易号=${resource.transactionId}`,
      );
    }

    return {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  /**
   * 微信支付主动查单补单
   */
  async queryAndSyncPayment(
    billId: string,
    userId: string,
    userRole: string,
    dto: WechatPayQueryDto,
  ) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          select: { tenantId: true },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    if (userRole === 'TENANT') {
      const userTenant = await this.prisma.tenant.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!userTenant || bill.contract.tenantId !== userTenant.id) {
        throw new ForbiddenException('您无权查询非本人的账单');
      }
    }

    const order = await this.paymentProvider.queryOrder(dto.outTradeNo);
    if (!order) {
      return {
        synced: false,
        message: '未查询到该支付单',
        order: null,
      };
    }

    let synced = false;
    if (order.status === 'SUCCESS' && order.amount) {
      const idempotencyKey = `wechat_pay_${dto.outTradeNo}`;
      const existing = await this.prisma.paymentRecord.findUnique({
        where: { idempotencyKey },
      });

      if (!existing) {
        await this.billPaymentService.addPayment(
          billId,
          {
            amount: order.amount,
            paymentMethod: PaymentMethod.WECHAT,
            transactionNumber: order.transactionId,
            idempotencyKey,
            notes: `微信支付查单自动补入账 (单号: ${dto.outTradeNo})`,
          },
          'SYSTEM_WECHAT_PAY',
        );
        synced = true;
      }
    }

    const updatedBill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        paymentRecords: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return {
      synced,
      order,
      bill: updatedBill,
    };
  }

  /**
   * 管理员申请微信支付退款（PAY-02）
   */
  async createRefund(
    billId: string,
    paymentId: string,
    dto: CreateWechatRefundDto,
    operatorId: string,
  ): Promise<WechatRefundResponseDto> {
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { id: paymentId },
      include: { bill: true },
    });

    if (!payment || payment.billId !== billId) {
      throw new NotFoundException('收款记录不存在');
    }

    if (payment.paymentMethod !== 'WECHAT') {
      throw new BadRequestException('非微信支付收款记录，不可发起微信退款');
    }

    if (payment.status !== 'CONFIRMED') {
      throw new BadRequestException(`收款记录当前状态为 ${payment.status}，不可退款`);
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('退款金额必须大于 0');
    }

    if (dto.amount > payment.amount) {
      throw new BadRequestException(`退款金额 (${dto.amount}分) 超过原付款金额 (${payment.amount}分)`);
    }

    // 检查原交易商户单号
    const outTradeNo = payment.idempotencyKey?.replace(/^wechat_pay_/, '') || payment.transactionNumber;
    if (!outTradeNo) {
      throw new BadRequestException('原收款记录缺少微信交易凭证');
    }

    const outRefundNo = dto.outRefundNo || `WR_${Date.now()}_${randomHex(4)}`;

    if (!this.paymentProvider.createRefund) {
      throw new BadRequestException('当前支付通道未实现退款能力');
    }

    // 调用微信退款
    const refundRes = await this.paymentProvider.createRefund({
      outTradeNo,
      transactionId: payment.transactionNumber || undefined,
      outRefundNo,
      refundAmount: dto.amount,
      totalAmount: payment.amount,
      reason: dto.reason,
    });

    // 退款成功后联动财务冲正
    let reversalPaymentId: string;
    let remainingPaidAmount: number;

    if (dto.amount === payment.amount) {
      // 全额退款：直接走标准的 voidPayment 机制
      const voidResult = await this.billPaymentService.voidPayment(
        billId,
        paymentId,
        operatorId,
        dto.reason || `微信支付退款 (${outRefundNo})`,
      );
      reversalPaymentId = voidResult.reversal?.id || '';
      remainingPaidAmount = voidResult.bill.paidAmount;
    } else {
      // 部分退款：创建一条负数冲正记录并扣减账单实缴额
      const partialReversal = await this.prisma.$transaction(async (tx) => {
        const rev = await tx.paymentRecord.create({
          data: {
            billId,
            amount: -dto.amount,
            paymentMethod: PaymentMethod.WECHAT,
            status: 'REVERSAL',
            paidAt: new Date(),
            confirmedBy: operatorId,
            notes: `微信支付部分退款 ${outRefundNo}，原收款: ${payment.id}`,
            idempotencyKey: `wechat_refund_${outRefundNo}`,
          },
        });

        const newPaid = Math.max(0, payment.bill.paidAmount - dto.amount);
        const newStatus = newPaid <= 0 ? 'PENDING' : newPaid < payment.bill.amount ? 'PARTIAL' : 'PAID';
        await tx.bill.update({
          where: { id: billId },
          data: { paidAmount: newPaid, status: newStatus },
        });

        return { rev, newPaid };
      });

      reversalPaymentId = partialReversal.rev.id;
      remainingPaidAmount = partialReversal.newPaid;
    }

    this.logger.log(
      `微信支付退款完成: 账单=${billId}, 原收款=${paymentId}, 退款单号=${outRefundNo}, 金额=${dto.amount}分`,
    );

    return {
      billId,
      paymentId,
      outRefundNo,
      refundId: refundRes.refundId,
      refundAmount: dto.amount,
      status: refundRes.status,
      reversalPaymentId,
      remainingPaidAmount,
    };
  }

  /**
   * 处理微信退款异步通知
   */
  async handleRefundNotify(
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<{ code: string; message: string }> {
    if (!this.paymentProvider.verifyAndParseRefundNotify) {
      throw new BadRequestException('当前支付通道不支持微信退款通知解析');
    }

    const resource = await this.paymentProvider.verifyAndParseRefundNotify(headers, body);
    this.logger.log(
      `收到微信退款通知: 退款单号=${resource.outRefundNo}, 状态=${resource.refundStatus}, 金额=${resource.refundAmount}分`,
    );

    return {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  /**
   * 微信支付日终自动对账与差异分析
   */
  async reconcileWechatPayments(
    dto: WechatReconciliationQueryDto,
  ): Promise<WechatReconciliationResponseDto> {
    const { billDate, autoSyncMissing } = dto;

    if (!this.paymentProvider.downloadTradeBill) {
      throw new BadRequestException('当前支付通道不支持微信对账单下载');
    }

    // 1. 获取微信官方账单交易流水
    const wechatBills = await this.paymentProvider.downloadTradeBill(billDate);

    // 2. 获取本地指定日期的微信收款记录
    const startOfDay = new Date(`${billDate}T00:00:00.000Z`);
    const endOfDay = new Date(`${billDate}T23:59:59.999Z`);

    const localPayments = await this.prisma.paymentRecord.findMany({
      where: {
        paymentMethod: 'WECHAT',
        status: 'CONFIRMED',
        paidAt: { gte: startOfDay, lte: endOfDay },
      },
      include: { bill: true },
    });

    const totalWechatCount = wechatBills.length;
    const totalWechatAmount = wechatBills.reduce((sum, b) => sum + b.amount, 0);
    const totalLocalCount = localPayments.length;
    const totalLocalAmount = localPayments.reduce((sum, p) => sum + p.amount, 0);

    const discrepancies: WechatReconciliationDiscrepancy[] = [];
    const matchedWechatOutTradeNos = new Set<string>();
    const matchedLocalPaymentIds = new Set<string>();

    let matchedCount = 0;
    let matchedAmount = 0;

    // 构建本地支付单查找索引 (outTradeNo -> PaymentRecord)
    const localByOutTradeNo = new Map<string, typeof localPayments[0]>();
    const localByTxNumber = new Map<string, typeof localPayments[0]>();

    for (const p of localPayments) {
      const outTradeNo = p.idempotencyKey?.replace(/^wechat_pay_/, '');
      if (outTradeNo) {
        localByOutTradeNo.set(outTradeNo, p);
      }
      if (p.transactionNumber) {
        localByTxNumber.set(p.transactionNumber, p);
      }
    }

    // 3. 以微信账单为主进行逐笔比对
    for (const wb of wechatBills) {
      const local = localByOutTradeNo.get(wb.outTradeNo) || localByTxNumber.get(wb.transactionId);

      if (!local) {
        // 微信有，本地无 -> REMOTE_ONLY 单边账
        let synced = false;
        if (autoSyncMissing) {
          // 尝试自动补账：需要能解析出 billId
          try {
            if ('getOrder' in this.paymentProvider) {
              const order = (this.paymentProvider as any).getOrder(wb.outTradeNo);
              if (order?.billId) {
                await this.billPaymentService.addPayment(
                  order.billId,
                  {
                    amount: wb.amount,
                    paymentMethod: PaymentMethod.WECHAT,
                    transactionNumber: wb.transactionId,
                    idempotencyKey: `wechat_pay_${wb.outTradeNo}`,
                    notes: `对账单自动补单入账 (${billDate})`,
                  },
                  'SYSTEM_RECONCILIATION',
                );
                synced = true;
              }
            }
          } catch (err: any) {
            this.logger.error(`对账自动补单失败: ${err.message}`);
          }
        }

        discrepancies.push({
          type: 'REMOTE_ONLY',
          outTradeNo: wb.outTradeNo,
          transactionId: wb.transactionId,
          wechatAmount: wb.amount,
          synced,
          reason: synced ? '已自动补账入库' : '微信已支付但本地未入账',
        });
      } else {
        matchedWechatOutTradeNos.add(wb.outTradeNo);
        matchedLocalPaymentIds.add(local.id);

        if (local.amount === wb.amount) {
          matchedCount++;
          matchedAmount += wb.amount;
        } else {
          // 金额不符
          discrepancies.push({
            type: 'AMOUNT_MISMATCH',
            outTradeNo: wb.outTradeNo,
            transactionId: wb.transactionId,
            wechatAmount: wb.amount,
            localAmount: local.amount,
            reason: `金额不一致：微信 ${wb.amount}分，本地 ${local.amount}分`,
          });
        }
      }
    }

    // 4. 反查本地是否有微信未记录的交易 (LOCAL_ONLY)
    for (const p of localPayments) {
      if (!matchedLocalPaymentIds.has(p.id)) {
        const outTradeNo = p.idempotencyKey?.replace(/^wechat_pay_/, '') || p.id;
        discrepancies.push({
          type: 'LOCAL_ONLY',
          outTradeNo,
          transactionId: p.transactionNumber || undefined,
          localAmount: p.amount,
          reason: '本地有收款记录但微信对账单无此交易凭单',
        });
      }
    }

    const remoteOnlyCount = discrepancies.filter((d) => d.type === 'REMOTE_ONLY').length;
    const localOnlyCount = discrepancies.filter((d) => d.type === 'LOCAL_ONLY').length;
    const amountMismatchCount = discrepancies.filter((d) => d.type === 'AMOUNT_MISMATCH').length;

    return {
      billDate,
      totalWechatCount,
      totalWechatAmount,
      totalLocalCount,
      totalLocalAmount,
      matchedCount,
      matchedAmount,
      remoteOnlyCount,
      localOnlyCount,
      amountMismatchCount,
      discrepancies,
    };
  }
}
