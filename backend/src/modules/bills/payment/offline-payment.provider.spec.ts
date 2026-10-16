import { describe, expect, it } from 'vitest';
import { OfflinePaymentProvider } from './offline-payment.provider.js';

describe('OfflinePaymentProvider', () => {
  it('只在本地记下订单，不产生外部支付单', async () => {
    const provider = new OfflinePaymentProvider();
    const order = await provider.createOrder({
      billId: 'bill-1',
      amount: 10000,
      paymentMethod: 'CASH',
    });

    expect(order.provider).toBe('offline');
    expect(order.status).toBe('RECORDED');
    await expect(provider.queryOrder(order.orderId)).resolves.toMatchObject({ status: 'RECORDED' });
    await expect(provider.refund(order.orderId, 1000)).resolves.toMatchObject({
      amount: 1000,
      status: 'RECORDED',
    });
  });
});
