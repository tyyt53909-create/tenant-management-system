import { randomUUID } from 'node:crypto';
import type { PaymentOrder, PaymentOrderRequest, PaymentProvider } from './payment-provider.js';

/** 线下收款。只在进程内记下订单号，不调用支付机构。 */
export class OfflinePaymentProvider implements PaymentProvider {
  readonly name = 'offline';
  private readonly orders = new Map<string, PaymentOrder & { amount: number }>();

  async createOrder(request: PaymentOrderRequest): Promise<PaymentOrder> {
    const order = {
      orderId: randomUUID(),
      status: 'RECORDED' as const,
      provider: this.name,
      amount: request.amount,
    };
    this.orders.set(order.orderId, order);
    return { orderId: order.orderId, status: order.status, provider: order.provider };
  }

  async queryOrder(orderId: string) {
    const order = this.orders.get(orderId);
    return order ? { orderId: order.orderId, status: order.status } : null;
  }

  async refund(orderId: string, amount: number) {
    if (!this.orders.has(orderId)) {
      throw new Error('线下订单不存在');
    }
    return { orderId, amount, status: 'RECORDED' as const };
  }
}
