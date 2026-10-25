import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentsController } from './payments.controller.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';

describe('PaymentsController (T293 / PAY-01)', () => {
  let controller: PaymentsController;
  let service: any;

  beforeEach(() => {
    service = {
      handleNotify: vi.fn().mockResolvedValue({ code: 'SUCCESS', message: '成功' }),
    };
    controller = new PaymentsController(service as WechatPaymentService);
  });

  it('handleWechatNotify 委托 WechatPaymentService 处理并返回结果', async () => {
    const headers = { 'wechatpay-signature': 'sig123' };
    const body = { id: 'evt-1' };

    const res = await controller.handleWechatNotify(headers, body);
    expect(res).toEqual({ code: 'SUCCESS', message: '成功' });
    expect(service.handleNotify).toHaveBeenCalledWith(headers, body);
  });
});
