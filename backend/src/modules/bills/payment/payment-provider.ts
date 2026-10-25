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

export interface PaymentProvider {
  readonly name: string;
  createOrder(request: PaymentOrderRequest): Promise<PaymentOrder>;
  queryOrder(orderId: string): Promise<{ orderId: string; status: string; amount?: number; transactionId?: string } | null>;
  refund(orderId: string, amount: number): Promise<{ orderId: string; amount: number; status: 'RECORDED' }>;
  createJsapiOrder?(request: JsapiOrderRequest): Promise<JsapiPaymentParams>;
  verifyAndParseNotify?(headers: Record<string, string | string[] | undefined>, body: any): Promise<WechatPaymentNotifyResource>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
