import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  JsapiOrderRequest,
  JsapiPaymentParams,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentProvider,
  RefundOrderRequest,
  RefundOrderResult,
  WechatBillTradeItem,
  WechatPaymentNotifyResource,
  WechatRefundNotifyResource,
} from './payment-provider.js';

export interface MockStoredOrder {
  outTradeNo: string;
  billId: string;
  amount: number;
  openid: string;
  description: string;
  status: 'NOTPAY' | 'SUCCESS' | 'REFUND';
  transactionId?: string;
  attach?: string;
  createdAt: number;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'wechat-mock';
  private readonly logger = new Logger(MockPaymentProvider.name);
  private readonly orders = new Map<string, MockStoredOrder>();
  private readonly refunds = new Map<string, RefundOrderResult>();
  private customBills: WechatBillTradeItem[] | null = null;

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
      `WXP_${request.billId.slice(-6)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
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

    if (body?.out_trade_no) {
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

  getOrder(outTradeNo: string): MockStoredOrder | undefined {
    return this.orders.get(outTradeNo);
  }

  async createRefund(request: RefundOrderRequest): Promise<RefundOrderResult> {
    const refundId = `mock_ref_${randomUUID().replace(/-/g, '')}`;
    const result: RefundOrderResult = {
      outRefundNo: request.outRefundNo,
      refundId,
      status: 'SUCCESS',
      refundAmount: request.refundAmount,
      channel: 'ORIGINAL',
    };
    this.refunds.set(request.outRefundNo, result);
    const order = this.orders.get(request.outTradeNo);
    if (order) {
      order.status = 'REFUND';
    }
    this.logger.log(
      `[MOCK PAYMENT] 微信退款成功: 原单号=${request.outTradeNo}, 退款单号=${request.outRefundNo}, 金额=${request.refundAmount}分`,
    );
    return result;
  }

  async queryRefund(outRefundNo: string): Promise<RefundOrderResult | null> {
    return this.refunds.get(outRefundNo) || null;
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
        // 如果不是 base64 json，继续走下面
      }
    }

    if (body?.out_refund_no || body?.outRefundNo) {
      return this.handleRefundNotifySuccess(body);
    }

    throw new Error('模拟退款通知报文解析失败');
  }

  private handleRefundNotifySuccess(data: any): WechatRefundNotifyResource {
    const outRefundNo = data.out_refund_no || data.outRefundNo;
    const outTradeNo = data.out_trade_no || data.outTradeNo || 'mock_out_trade_no';
    const transactionId = data.transaction_id || data.transactionId || 'mock_tx_id';
    const refundId = data.refund_id || data.refundId || `mock_ref_${randomUUID()}`;
    const refundAmount = Number(
      data.amount?.refund ?? data.amount?.payer_refund ?? data.refundAmount ?? 0,
    );
    const refundStatus = (data.refund_status || data.refundStatus || 'SUCCESS') as
      | 'SUCCESS'
      | 'CLOSED'
      | 'ABNORMAL';

    this.logger.log(
      `[MOCK PAYMENT] 收到模拟退款通知: 退款单号=${outRefundNo}, 状态=${refundStatus}, 金额=${refundAmount}分`,
    );

    return {
      outTradeNo,
      transactionId,
      outRefundNo,
      refundId,
      refundStatus,
      refundAmount,
      successTime: data.success_time || new Date().toISOString(),
    };
  }

  setMockBills(bills: WechatBillTradeItem[] | null): void {
    this.customBills = bills;
  }

  async downloadTradeBill(billDate: string): Promise<WechatBillTradeItem[]> {
    if (this.customBills !== null) {
      return this.customBills;
    }
    const items: WechatBillTradeItem[] = [];
    for (const order of this.orders.values()) {
      if (order.status === 'SUCCESS' || order.status === 'REFUND') {
        items.push({
          tradeTime: `${billDate} 12:00:00`,
          outTradeNo: order.outTradeNo,
          transactionId: order.transactionId || `mock_tx_${order.outTradeNo}`,
          amount: order.amount,
          tradeState: order.status === 'REFUND' ? 'REFUND' : 'SUCCESS',
          tradeType: 'JSAPI',
        });
      }
    }
    return items;
  }

  clear(): void {
    this.orders.clear();
    this.refunds.clear();
    this.customBills = null;
  }
}
