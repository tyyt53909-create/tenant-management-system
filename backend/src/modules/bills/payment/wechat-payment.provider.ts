import { Logger } from '@nestjs/common';
import {
  createDecipheriv,
  createSign,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type {
  JsapiOrderRequest,
  JsapiPaymentParams,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentProvider,
  WechatPaymentNotifyResource,
} from './payment-provider.js';

export interface WechatPaymentConfig {
  appId: string;
  mchId: string;
  serialNo?: string;
  privateKey?: string;
  apiV3Key?: string;
  notifyUrl?: string;
}

export class WechatPaymentProvider implements PaymentProvider {
  readonly name = 'wechat';
  private readonly logger = new Logger(WechatPaymentProvider.name);
  private readonly baseUrl = 'https://api.mch.weixin.qq.com';

  constructor(private readonly config: WechatPaymentConfig) {}

  async createOrder(request: PaymentOrderRequest): Promise<PaymentOrder> {
    return {
      orderId: `wechat_order_${randomUUID()}`,
      status: 'RECORDED',
      provider: this.name,
    };
  }

  /**
   * 微信支付 JSAPI 下单
   * POST /v3/pay/transactions/jsapi
   */
  async createJsapiOrder(request: JsapiOrderRequest): Promise<JsapiPaymentParams> {
    const outTradeNo =
      request.outTradeNo ||
      `WXP_${request.billId.slice(-6)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const url = '/v3/pay/transactions/jsapi';
    const notifyUrl = this.config.notifyUrl || 'https://api.example.com/api/payments/wechat/notify';

    const payload = {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: request.description,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total: request.amount,
        currency: 'CNY',
      },
      payer: {
        openid: request.openid,
      },
      attach: request.attach,
    };

    const bodyStr = JSON.stringify(payload);
    const authorization = this.buildAuthorization('POST', url, bodyStr);

    const response = await fetch(`${this.baseUrl}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authorization,
      },
      body: bodyStr,
    });

    const data = (await response.json()) as any;
    if (!response.ok || !data.prepay_id) {
      this.logger.error(`微信支付 JSAPI 下单失败: [${response.status}] ${JSON.stringify(data)}`);
      throw new Error(`微信支付下单失败: ${data?.message || data?.code || '未知错误'}`);
    }

    const prepayId = data.prepay_id as string;
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(16).toString('hex');
    const packageVal = `prepay_id=${prepayId}`;

    const paySign = this.buildJsapiPaySign(
      this.config.appId,
      timeStamp,
      nonceStr,
      packageVal,
    );

    return {
      appId: this.config.appId,
      timeStamp,
      nonceStr,
      package: packageVal,
      signType: 'RSA',
      paySign,
      outTradeNo,
    };
  }

  /**
   * 微信支付查单
   * GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}
   */
  async queryOrder(
    outTradeNo: string,
  ): Promise<{ orderId: string; status: string; amount?: number; transactionId?: string } | null> {
    const url = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.config.mchId)}`;
    const authorization = this.buildAuthorization('GET', url, '');

    try {
      const response = await fetch(`${this.baseUrl}${url}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
        },
      });

      if (response.status === 404) {
        return null;
      }

      const data = (await response.json()) as any;
      if (!response.ok) {
        this.logger.error(`微信支付查单失败: [${response.status}] ${JSON.stringify(data)}`);
        return null;
      }

      return {
        orderId: data.out_trade_no,
        status: data.trade_state, // SUCCESS, NOTPAY, CLOSED, REFUND 等
        amount: data.amount?.total,
        transactionId: data.transaction_id,
      };
    } catch (err: any) {
      this.logger.error(`微信支付查单异常: ${err.message}`);
      return null;
    }
  }

  async refund(
    orderId: string,
    amount: number,
  ): Promise<{ orderId: string; amount: number; status: 'RECORDED' }> {
    // 基础退款接口后续在 PAY-02 完善
    return { orderId, amount, status: 'RECORDED' };
  }

  /**
   * 验证并解密微信支付回调通知
   */
  async verifyAndParseNotify(
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<WechatPaymentNotifyResource> {
    if (!this.config.apiV3Key) {
      throw new Error('未配置 WECHAT_PAY_API_V3_KEY，无法解密回调通知');
    }

    const resource = body?.resource;
    if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') {
      throw new Error('不支持的加密算法或缺少 resource 数据');
    }

    // 解密密文
    const decryptedText = this.decryptAesGcm(
      this.config.apiV3Key,
      resource.nonce,
      resource.associated_data || '',
      resource.ciphertext,
    );

    const decrypted = JSON.parse(decryptedText);
    const outTradeNo = decrypted.out_trade_no;
    const transactionId = decrypted.transaction_id;
    const tradeState = decrypted.trade_state;
    const amount = Number(decrypted.amount?.total ?? 0);
    const openid = decrypted.payer?.openid || '';

    return {
      outTradeNo,
      transactionId,
      tradeState,
      amount,
      openid,
      successTime: decrypted.success_time,
      attach: decrypted.attach,
    };
  }

  /**
   * 构建微信 API v3 请求授权头部 (Authorization)
   */
  private buildAuthorization(method: string, url: string, bodyStr: string): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const signatureMessage = `${method}\n${url}\n${timestamp}\n${nonce}\n${bodyStr}\n`;

    const signature = this.signWithPrivateKey(signatureMessage);
    const serialNo = this.config.serialNo || '';
    const mchId = this.config.mchId;

    return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
  }

  /**
   * 构建 JSAPI 调起支付签名 (paySign)
   */
  private buildJsapiPaySign(
    appId: string,
    timeStamp: string,
    nonceStr: string,
    packageVal: string,
  ): string {
    const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageVal}\n`;
    return this.signWithPrivateKey(message);
  }

  /**
   * 使用商户私钥计算 RSA-SHA256 签名 (Base64)
   */
  private signWithPrivateKey(message: string): string {
    if (!this.config.privateKey) {
      throw new Error('未配置 WECHAT_PAY_PRIVATE_KEY，无法生成商户签名');
    }
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    return signer.sign(this.config.privateKey, 'base64');
  }

  /**
   * AEAD_AES_256_GCM 算法解密
   */
  private decryptAesGcm(
    key: string,
    nonce: string,
    associatedData: string,
    ciphertext: string,
  ): string {
    const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
    const authTag = ciphertextBuffer.subarray(ciphertextBuffer.length - 16);
    const data = ciphertextBuffer.subarray(0, ciphertextBuffer.length - 16);

    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key, 'utf8'),
      Buffer.from(nonce, 'utf8'),
    );
    decipher.setAuthTag(authTag);
    if (associatedData) {
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    }

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
