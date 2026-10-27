import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, createCipheriv, randomBytes } from 'node:crypto';
import { WechatPaymentProvider } from './wechat-payment.provider.js';
import { MockPaymentProvider } from './mock-payment.provider.js';

describe('Payment Providers (T293 / PAY-01)', () => {
  describe('MockPaymentProvider', () => {
    let mock: MockPaymentProvider;

    beforeEach(() => {
      mock = new MockPaymentProvider();
    });

    it('createJsapiOrder 生成模拟调起参数与待付订单', async () => {
      const res = await mock.createJsapiOrder({
        billId: 'bill-123',
        amount: 300000,
        description: '房租账单',
        openid: 'openid_user_1',
      });

      expect(res.appId).toBe('wx_mock_appid');
      expect(res.package).toContain('prepay_id=mock_prepay_');
      expect(res.signType).toBe('RSA');
      expect(res.outTradeNo).toMatch(/^WXP_/);

      const order = mock.getOrder(res.outTradeNo);
      expect(order).toBeDefined();
      expect(order?.status).toBe('NOTPAY');
      expect(order?.amount).toBe(300000);
    });

    it('queryOrder 成功查询订单状态', async () => {
      const created = await mock.createJsapiOrder({
        billId: 'bill-123',
        amount: 150000,
        description: '押金账单',
        openid: 'openid_user_2',
      });

      const q1 = await mock.queryOrder(created.outTradeNo);
      expect(q1?.status).toBe('NOTPAY');

      // 模拟微信端完成支付
      mock.simulateSuccess(created.outTradeNo, 'wx_trans_999');

      const q2 = await mock.queryOrder(created.outTradeNo);
      expect(q2?.status).toBe('SUCCESS');
      expect(q2?.transactionId).toBe('wx_trans_999');
    });

    it('verifyAndParseNotify 解析模拟回调通知', async () => {
      const notifyBody = {
        out_trade_no: 'WXP_001',
        transaction_id: 'TX_999',
        amount: { total: 200000 },
        payer: { openid: 'mock_openid' },
      };

      const res = await mock.verifyAndParseNotify({}, notifyBody);
      expect(res.outTradeNo).toBe('WXP_001');
      expect(res.transactionId).toBe('TX_999');
      expect(res.amount).toBe(200000);
      expect(res.tradeState).toBe('SUCCESS');
    });

    it('createRefund 与 queryRefund 模拟退款操作 (PAY-02)', async () => {
      const refundRes = await mock.createRefund({
        outTradeNo: 'WXP_001',
        outRefundNo: 'WR_001',
        refundAmount: 50000,
        totalAmount: 100000,
        reason: '退押金',
      });

      expect(refundRes.outRefundNo).toBe('WR_001');
      expect(refundRes.status).toBe('SUCCESS');
      expect(refundRes.refundAmount).toBe(50000);

      const queried = await mock.queryRefund('WR_001');
      expect(queried?.refundId).toBe(refundRes.refundId);
    });

    it('verifyAndParseRefundNotify 模拟解析退款通知报文', async () => {
      const refundNotify = {
        out_trade_no: 'WXP_001',
        out_refund_no: 'WR_001',
        refund_status: 'SUCCESS',
        amount: { refund: 50000 },
      };

      const res = await mock.verifyAndParseRefundNotify({}, refundNotify);
      expect(res.outRefundNo).toBe('WR_001');
      expect(res.refundStatus).toBe('SUCCESS');
      expect(res.refundAmount).toBe(50000);
    });

    it('downloadTradeBill 返回对账单项目', async () => {
      await mock.createJsapiOrder({
        billId: 'b-recon',
        amount: 8800,
        description: '测试对账',
        openid: 'o1',
      });
      const order = Array.from((mock as any).orders.values())[0] as any;
      mock.simulateSuccess(order.outTradeNo);

      const bills = await mock.downloadTradeBill('2026-10-27');
      expect(bills.length).toBeGreaterThanOrEqual(1);
      expect(bills[0].outTradeNo).toBe(order.outTradeNo);
      expect(bills[0].amount).toBe(8800);
    });
  });

  describe('WechatPaymentProvider (API v3)', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const apiV3Key = '12345678901234567890123456789012'; // 32 字节

    it('未配置私钥时下单抛出错误', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
      });

      await expect(
        provider.createJsapiOrder({
          billId: 'bill-1',
          amount: 1000,
          description: '测试',
          openid: 'o1',
        }),
      ).rejects.toThrow('未配置 WECHAT_PAY_PRIVATE_KEY');
    });

    it('正常配置下调用微信 JSAPI 接口生成合法调起参数', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
        serialNo: 'CERT_SERIAL_001',
        privateKey,
        apiV3Key,
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ prepay_id: 'wx20261025220000123456' }),
      } as any);

      const params = await provider.createJsapiOrder({
        billId: 'bill-real-1',
        amount: 50000,
        description: '测试账单',
        openid: 'openid_real_1',
      });

      expect(params.appId).toBe('wx_real_appid');
      expect(params.package).toBe('prepay_id=wx20261025220000123456');
      expect(params.signType).toBe('RSA');
      expect(params.paySign).toBeTypeOf('string');
      expect(params.paySign.length).toBeGreaterThan(20);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('WECHATPAY2-SHA256-RSA2048'),
          }),
        }),
      );
    });

    it('成功解密微信 AEAD_AES_256_GCM 回调密文', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
        privateKey,
        apiV3Key,
      });

      // 准备明文数据
      const plaintext = JSON.stringify({
        out_trade_no: 'WXP_ORDER_123',
        transaction_id: '420000123456789',
        trade_state: 'SUCCESS',
        amount: { total: 88800 },
        payer: { openid: 'user_openid_123' },
        success_time: '2026-10-25T21:00:00+08:00',
        attach: JSON.stringify({ billId: 'bill-test-abc' }),
      });

      // 使用相同的 AES-256-GCM 算法加密以模拟微信平台密文
      const nonce = randomBytes(12).toString('hex'); // 12-16 字节
      const associatedData = 'transaction';
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
      cipher.setAAD(Buffer.from(associatedData, 'utf8'));
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const ciphertext = Buffer.concat([encrypted, authTag]).toString('base64');

      const notifyBody = {
        resource: {
          algorithm: 'AEAD_AES_256_GCM',
          ciphertext,
          associated_data: associatedData,
          nonce,
        },
      };

      const res = await provider.verifyAndParseNotify({}, notifyBody);
      expect(res.outTradeNo).toBe('WXP_ORDER_123');
      expect(res.transactionId).toBe('420000123456789');
      expect(res.tradeState).toBe('SUCCESS');
      expect(res.amount).toBe(88800);
      expect(res.openid).toBe('user_openid_123');
      expect(res.attach).toContain('bill-test-abc');
    });

    it('createRefund 成功调用微信 API v3 退款端点', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
        serialNo: 'CERT_SERIAL_001',
        privateKey,
        apiV3Key,
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          refund_id: '500000001',
          out_refund_no: 'WR_123',
          status: 'SUCCESS',
          amount: { refund: 20000 },
          channel: 'ORIGINAL',
        }),
      } as any);

      const res = await provider.createRefund({
        outTradeNo: 'WXP_123',
        outRefundNo: 'WR_123',
        refundAmount: 20000,
        totalAmount: 50000,
        reason: '退押金',
      });

      expect(res.refundId).toBe('500000001');
      expect(res.outRefundNo).toBe('WR_123');
      expect(res.status).toBe('SUCCESS');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('parseTradeBillCsv 正确解析微信官方 CSV 格式对账单', () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
      });

      const csvContent =
        '交易时间,公众账号ID,商户号,子商户号,设备号,微信订单号,商户订单号,用户标识,交易类型,交易状态,付款银行,货币种类,应结订单金额\n' +
        '`2026-10-27 10:15:20,`wx123,`mch123,`sub_mch,`dev01,`4200001,`WXP_001,`o1,`JSAPI,`SUCCESS,`BOC,`CNY,`100.50\n' +
        '总交易单数,`1\n总交易金额,`100.50';

      const items = provider.parseTradeBillCsv(csvContent);
      expect(items.length).toBe(1);
      expect(items[0].outTradeNo).toBe('WXP_001');
      expect(items[0].transactionId).toBe('4200001');
      expect(items[0].amount).toBe(10050); // 100.50 元 = 10050 分
      expect(items[0].tradeState).toBe('SUCCESS');
    });
  });
});
