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

export interface PaymentProvider {
  readonly name: string;
  createOrder(request: PaymentOrderRequest): Promise<PaymentOrder>;
  queryOrder(orderId: string): Promise<{ orderId: string; status: string } | null>;
  refund(orderId: string, amount: number): Promise<{ orderId: string; amount: number; status: 'RECORDED' }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
