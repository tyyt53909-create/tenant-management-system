export interface PaymentOrderRequest {
  billId: string;
  amount: number;
  paymentMethod: string;
  description?: string;
}

export interface PaymentOrder {
  orderId: string;
  status: 'RECORDED';
  provider: string;
}

export interface JsapiOrderRequest {
  billId: string;
  amount: number; // 单位：分
  description: string;
  openid: string;
  outTradeNo?: string;
  attach?: string;
}

export interface JsapiPaymentParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: string;
  paySign: string;
  outTradeNo: string;
}

export interface WechatPaymentNotifyResource {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  amount: number; // 单位：分
  openid: string;
  successTime?: string;
  attach?: string;
}

export interface CreateRefundRequest {
  outTradeNo?: string;
  transactionId?: string;
  outRefundNo: string;
  reason?: string;
  amount: number; // 本次退款金额（分）
  totalAmount: number; // 原订单总金额（分）
  notifyUrl?: string;
}

export interface RefundResult {
  outRefundNo: string;
  refundId: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  amount: number;
  userReceivedAccount?: string;
  successTime?: string;
}

export interface WechatRefundNotifyResource {
  outTradeNo: string;
  transactionId: string;
  outRefundNo: string;
  refundId: string;
  refundStatus: 'SUCCESS' | 'ABNORMAL' | 'CLOSED';
  successTime?: string;
  amount: {
    total: number;
    refund: number;
  };
  userReceivedAccount?: string;
}

export interface TradeBillItem {
  tradeTime: string;
  appId: string;
  mchId: string;
  transactionId: string;
  outTradeNo: string;
  tradeType: string;
  tradeState: string;
  totalAmount: number; // 分
  outRefundNo?: string;
  refundId?: string;
  refundStatus?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(request: PaymentOrderRequest): Promise<PaymentOrder>;
  queryOrder(orderId: string): Promise<{ orderId: string; status: string; amount?: number; transactionId?: string } | null>;
  refund(orderId: string, amount: number): Promise<{ orderId: string; amount: number; status: 'RECORDED' }>;
  createJsapiOrder?(request: JsapiOrderRequest): Promise<JsapiPaymentParams>;
  verifyAndParseNotify?(headers: Record<string, string | string[] | undefined>, body: any): Promise<WechatPaymentNotifyResource>;
  createRefund?(request: CreateRefundRequest): Promise<RefundResult>;
  queryRefund?(outRefundNo: string): Promise<RefundResult | null>;
  verifyAndParseRefundNotify?(headers: Record<string, string | string[] | undefined>, body: any): Promise<WechatRefundNotifyResource>;
  downloadTradeBill?(billDate: string): Promise<TradeBillItem[]>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
