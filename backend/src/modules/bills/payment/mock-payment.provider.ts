import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateRefundRequest,
  JsapiOrderRequest,
  JsapiPaymentParams,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentProvider,
  RefundResult,
  TradeBillItem,
  WechatPaymentNotifyResource,
  WechatRefundNotifyResource,
} from './payment-provider.js';

export interface MockStoredOrder {
  outTradeNo: string;
  billId?: string;
  amount: number;
  openid: string;
  description: string;
  status: 'NOTPAY' | 'SUCCESS' | 'REFUND';
  transactionId?: string;
  attach?: string;
  createdAt: number;
}

export interface MockStoredRefund {
  outRefundNo: string;
  refundId: string;
  outTradeNo?: string;
  transactionId?: string;
  amount: number;
  reason?: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  createdAt: number;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'wechat-mock';
  private readonly logger = new Logger(MockPaymentProvider.name);
  private readonly orders = new Map<string, MockStoredOrder>();
  private readonly refunds = new Map<string, MockStoredRefund>();
  private injectedTradeBills: TradeBillItem[] | null = null;

  async createOrder(request: PaymentOrderRequest): Promise<PaymentOrder> {
    const orderId = `mock_order_${randomUUID()}`;
    this.logger.log(`[MOCK PAYMENT] 创建离线记账订单: ${orderId}, 金额: ${request.amount}`);
    return {
      orderId,
      status: 'RECORDED',
      provider: this.name,
    };
  }

  async createJsapiOrder(request: JsapiOrderRequest): Promise<JsapiPaymentParams> {
    const outTradeNo =
      request.outTradeNo ||
      `WXP_${(request.billId || 'GENERAL').slice(-6)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const prepayId = `mock_prepay_${randomUUID().replace(/-/g, '')}`;
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = `mock_nonce_${randomUUID().slice(0, 16)}`;
    const packageVal = `prepay_id=${prepayId}`;

    const storedOrder: MockStoredOrder = {
      outTradeNo,
      billId: request.billId,
      amount: request.amount,
      openid: request.openid,
      description: request.description,
      status: 'NOTPAY',
      attach: request.attach,
      createdAt: Date.now(),
    };
    this.orders.set(outTradeNo, storedOrder);

    this.logger.log(
      `[MOCK PAYMENT] 📱 微信支付 JSAPI 下单成功: 账单=${request.billId}, 单号=${outTradeNo}, 金额=${request.amount}分, prepay_id=${prepayId}`,
    );

    return {
      appId: 'wx_mock_appid',
      timeStamp,
      nonceStr,
      package: packageVal,
      signType: 'RSA',
      paySign: `mock_pay_sign_${randomUUID().slice(0, 24)}`,
      outTradeNo,
    };
  }

  async queryOrder(
    orderId: string,
  ): Promise<{ orderId: string; status: string; amount?: number; transactionId?: string } | null> {
    const order = this.orders.get(orderId);
    if (!order) {
      return null;
    }
    return {
      orderId: order.outTradeNo,
      status: order.status,
      amount: order.amount,
      transactionId: order.transactionId,
    };
  }

  async refund(
    orderId: string,
    amount: number,
  ): Promise<{ orderId: string; amount: number; status: 'RECORDED' }> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'REFUND';
    }
    return {
      orderId,
      amount,
      status: 'RECORDED',
    };
  }

  async verifyAndParseNotify(
    _headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<WechatPaymentNotifyResource> {
    // 支持直接传入明文解密后的资源（测试用），或模拟解密
    if (body?.resource?.ciphertext && typeof body.resource.ciphertext === 'string') {
      try {
        const decoded = Buffer.from(body.resource.ciphertext, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        return this.handleNotifySuccess(parsed);
      } catch {
        // 如果不是 base64 json，继续走下面
      }
    }

    if (body?.resource?.out_trade_no || body?.resource?.outTradeNo) {
      return this.handleNotifySuccess(body.resource);
    }

    if (body?.out_trade_no || body?.outTradeNo) {
      return this.handleNotifySuccess(body);
    }

    throw new Error('模拟支付通知报文解析失败');
  }

  private handleNotifySuccess(data: any): WechatPaymentNotifyResource {
    const outTradeNo = data.out_trade_no || data.outTradeNo;
    const transactionId = data.transaction_id || data.transactionId || `mock_tx_${randomUUID()}`;
    const amount = Number(data.amount?.total ?? data.amount ?? 0);
    const openid = data.payer?.openid || data.openid || 'mock_openid';

    const order = this.orders.get(outTradeNo);
    if (order) {
      order.status = 'SUCCESS';
      order.transactionId = transactionId;
    }

    this.logger.log(
      `[MOCK PAYMENT] 收到模拟支付成功通知: 单号=${outTradeNo}, 交易号=${transactionId}, 金额=${amount}分`,
    );

    return {
      outTradeNo,
      transactionId,
      tradeState: 'SUCCESS',
      amount,
      openid,
      successTime: data.success_time || new Date().toISOString(),
      attach: data.attach || order?.attach,
    };
  }

  /**
   * 测试辅助：模拟用户已在微信完成支付
   */
  simulateSuccess(outTradeNo: string, transactionId?: string): WechatPaymentNotifyResource {
    let order = this.orders.get(outTradeNo);
    const txId = transactionId || `mock_wx_tx_${randomUUID().replace(/-/g, '')}`;
    if (!order) {
      order = {
        outTradeNo,
        billId: 'mock_bill',
        amount: 10000,
        openid: 'mock_openid',
        description: 'mock_description',
        status: 'SUCCESS',
        transactionId: txId,
        createdAt: Date.now(),
      };
      this.orders.set(outTradeNo, order);
    } else {
      order.status = 'SUCCESS';
      order.transactionId = txId;
    }
    return {
      outTradeNo,
      transactionId: txId,
      tradeState: 'SUCCESS',
      amount: order.amount,
      openid: order.openid,
      successTime: new Date().toISOString(),
      attach: order.attach,
    };
  }

  async createRefund(request: CreateRefundRequest): Promise<RefundResult> {
    const refundId = `mock_refund_${randomUUID()}`;
    const refundRecord: MockStoredRefund = {
      outRefundNo: request.outRefundNo,
      refundId,
      outTradeNo: request.outTradeNo,
      transactionId: request.transactionId,
      amount: request.amount,
      reason: request.reason,
      status: 'PROCESSING',
      createdAt: Date.now(),
    };
    this.refunds.set(request.outRefundNo, refundRecord);

    this.logger.log(
      `[MOCK PAYMENT] ↩️ 发起模拟退款: 单号=${request.outRefundNo}, 原单号=${request.outTradeNo || request.transactionId}, 金额=${request.amount}分`,
    );

    return {
      outRefundNo: request.outRefundNo,
      refundId,
      status: 'PROCESSING',
      amount: request.amount,
      userReceivedAccount: '招商银行储蓄卡(0123)',
    };
  }

  async queryRefund(outRefundNo: string): Promise<RefundResult | null> {
    const refund = this.refunds.get(outRefundNo);
    if (!refund) return null;
    return {
      outRefundNo: refund.outRefundNo,
      refundId: refund.refundId,
      status: refund.status,
      amount: refund.amount,
      userReceivedAccount: '招商银行储蓄卡(0123)',
      successTime: refund.status === 'SUCCESS' ? new Date().toISOString() : undefined,
    };
  }

  async verifyAndParseRefundNotify(
    _headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<WechatRefundNotifyResource> {
    if (body?.resource?.ciphertext && typeof body.resource.ciphertext === 'string') {
      try {
        const decoded = Buffer.from(body.resource.ciphertext, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        return this.handleRefundNotifySuccess(parsed);
      } catch {
        // pass
      }
    }

    if (body?.out_refund_no || body?.outRefundNo) {
      return this.handleRefundNotifySuccess(body);
    }

    throw new Error('模拟退款通知报文解析失败');
  }

  private handleRefundNotifySuccess(data: any): WechatRefundNotifyResource {
    const outRefundNo = data.out_refund_no || data.outRefundNo;
    const refundId = data.refund_id || data.refundId || '';
    const outTradeNo = data.out_trade_no || data.outTradeNo || '';
    const transactionId = data.transaction_id || data.transactionId || '';
    const totalAmount = Number(data.amount?.total ?? 0);
    const refundAmount = Number(data.amount?.refund ?? data.amount ?? 0);
    const refundStatus = data.refund_status || data.refundStatus || 'SUCCESS';

    const refund = this.refunds.get(outRefundNo);
    if (refund) {
      refund.status = refundStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
      refund.refundId = refundId;
    }

    return {
      outTradeNo,
      transactionId,
      outRefundNo,
      refundId,
      refundStatus,
      successTime: data.success_time || undefined,
      amount: {
        total: totalAmount,
        refund: refundAmount,
      },
      userReceivedAccount: data.user_received_account || '招商银行储蓄卡(0123)',
    };
  }

  /**
   * 模拟退款成功触发
   */
  simulateRefundSuccess(outRefundNo: string): WechatRefundNotifyResource {
    const refund = this.refunds.get(outRefundNo);
    if (refund) {
      refund.status = 'SUCCESS';
    }
    return {
      outTradeNo: refund?.outTradeNo || '',
      transactionId: refund?.transactionId || '',
      outRefundNo,
      refundId: refund?.refundId || `mock_ref_${randomUUID()}`,
      refundStatus: 'SUCCESS',
      successTime: new Date().toISOString(),
      amount: {
        total: refund?.amount ?? 0,
        refund: refund?.amount ?? 0,
      },
      userReceivedAccount: '招商银行储蓄卡(0123)',
    };
  }

  async downloadTradeBill(_billDate: string): Promise<TradeBillItem[]> {
    if (this.injectedTradeBills) {
      return [...this.injectedTradeBills];
    }

    // 默认根据内存中成功的订单生成对账项
    const items: TradeBillItem[] = [];
    for (const order of this.orders.values()) {
      if (order.status === 'SUCCESS' && order.transactionId) {
        items.push({
          tradeTime: new Date(order.createdAt).toISOString(),
          appId: 'wx_mock_appid',
          mchId: '1600000001',
          transactionId: order.transactionId,
          outTradeNo: order.outTradeNo,
          tradeType: 'JSAPI',
          tradeState: 'SUCCESS',
          totalAmount: order.amount,
        });
      }
    }
    return items;
  }

  setMockTradeBillItems(items: TradeBillItem[] | null): void {
    this.injectedTradeBills = items;
  }

  getOrder(outTradeNo: string): MockStoredOrder | undefined {
    return this.orders.get(outTradeNo);
  }

  getRefund(outRefundNo: string): MockStoredRefund | undefined {
    return this.refunds.get(outRefundNo);
  }

  clear(): void {
    this.orders.clear();
    this.refunds.clear();
    this.injectedTradeBills = null;
  }
}
