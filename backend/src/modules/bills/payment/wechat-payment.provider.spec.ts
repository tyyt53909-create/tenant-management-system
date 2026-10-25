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

    it('成功解密退款通知 AEAD_AES_256_GCM 密文', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
        privateKey,
        apiV3Key,
      });

      const refundPlaintext = JSON.stringify({
        out_trade_no: 'WXP_001',
        transaction_id: '4200001',
        out_refund_no: 'RF_123456',
        refund_id: '5000001',
        refund_status: 'SUCCESS',
        amount: { total: 300000, refund: 300000 },
        user_received_account: '招商银行(0123)',
      });

      const nonce = randomBytes(12).toString('hex');
      const associatedData = 'refund';
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
      cipher.setAAD(Buffer.from(associatedData, 'utf8'));
      const encrypted = Buffer.concat([cipher.update(refundPlaintext, 'utf8'), cipher.final()]);
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

      const res = await provider.verifyAndParseRefundNotify({}, notifyBody);
      expect(res.outRefundNo).toBe('RF_123456');
      expect(res.refundId).toBe('5000001');
      expect(res.refundStatus).toBe('SUCCESS');
      expect(res.amount.refund).toBe(300000);
      expect(res.userReceivedAccount).toBe('招商银行(0123)');
    });

    it('解析微信交易对账单 CSV 内容', async () => {
      const provider = new WechatPaymentProvider({
        appId: 'wx_real_appid',
        mchId: '1600000001',
        privateKey,
        apiV3Key,
      });

      const mockCsv = [
        '交易时间,公众账号ID,商户号,子商户号,设备号,微信订单号,商户订单号,用户标识,交易类型,交易状态,付款银行,货币种类,总金额,应结订单金额,代金券金额,微信退款单号,商户退款单号,退款金额,充值券退款金额,退款类型,退款状态,商品名称,商户数据包,手续费,费率,订单金额,申请退款金额,费率备注',
        '`2026-10-25 10:00:00,`wx123,`1600001,`0,`,`420001,`WP_001,`openid1,`JSAPI,`SUCCESS,`BOC_CREDIT,`CNY,`250.00,`250.00,`0.00,`0,`0,`0.00,`0.00,`,`,`栖居生活,`attach,`1.50,`0.60%,`250.00,`0.00,`',
        '`总交易单数,`总交易额,`总退款金额,`总代金券金额,`手续费总金额,`订单总金额,`申请退款总金额',
        '`1,`250.00,`0.00,`0.00,`1.50,`250.00,`0.00',
      ].join('\n');

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ download_url: 'https://api.mch.weixin.qq.com/download/bill.csv' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => mockCsv,
        } as any);

      const items = await provider.downloadTradeBill('2026-10-25');
      expect(items).toHaveLength(1);
      expect(items[0].transactionId).toBe('420001');
      expect(items[0].outTradeNo).toBe('WP_001');
      expect(items[0].totalAmount).toBe(25000); // 250.00 元 -> 25000 分
      expect(items[0].tradeState).toBe('SUCCESS');
    });
  });
});
