import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BillPaymentService } from '../bill-payment.service.js';
import {
  PAYMENT_PROVIDER,
  type JsapiPaymentParams,
  type PaymentProvider,
} from './payment-provider.js';
import { WechatJsapiPayDto, WechatPayQueryDto } from '../dto/wechat-pay.dto.js';
import { PaymentMethod } from '../dto/create-payment.dto.js';
import { randomHex } from '../../../common/utils/secure-random.js';

@Injectable()
export class WechatPaymentService {
  private readonly logger = new Logger(WechatPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billPaymentService: BillPaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 租客发起微信支付 JSAPI 下单
   */
  async createJsapiOrder(
    billId: string,
    userId: string,
    userRole: string,
    dto?: WechatJsapiPayDto,
  ): Promise<JsapiPaymentParams> {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          select: {
            id: true,
            tenantId: true,
            tenant: { select: { id: true, userId: true } },
          },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    // 租客防越权校验：TENANT 必须是当前合同租客
    if (userRole === 'TENANT') {
      const userTenant = await this.prisma.tenant.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!userTenant || bill.contract.tenantId !== userTenant.id) {
        throw new ForbiddenException('您无权支付非本人的账单');
      }
    }

    if (bill.status === 'PAID' || bill.status === 'CANCELLED') {
      throw new BadRequestException(`账单当前为 ${bill.status} 状态，无需支付`);
    }

    // 计算未核销滞纳金与待缴金额
    const unsettledFees = await this.prisma.lateFee.findMany({
      where: { billId, confirmedAmount: { not: null } },
    });
    const outstandingFees = unsettledFees.reduce((sum, fee) => {
      const confirmed = fee.confirmedAmount ?? 0;
      const settled = fee.settledAmount ?? 0;
      return sum + Math.max(0, confirmed - settled);
    }, 0);

    const remaining = bill.amount - bill.paidAmount + outstandingFees;
    if (remaining <= 0) {
      throw new BadRequestException('账单已无待缴金额');
    }

    const payAmount = dto?.amount ? Math.min(dto.amount, remaining) : remaining;

    // 获取当前租客的微信 openid
    const identity = await this.prisma.userIdentity.findFirst({
      where: { userId, provider: 'WECHAT_MP' },
      select: { providerUserId: true },
    });

    let openid = identity?.providerUserId;
    if (!openid) {
      // 在模拟器或开发模式下允许使用 mock openid
      const isMock =
        this.paymentProvider.name === 'wechat-mock' ||
        this.configService.get('WECHAT_PAY_MOCK') === 'true' ||
        this.configService.get('NODE_ENV') !== 'production';

      if (isMock) {
        openid = `mock_openid_${userId}`;
      } else {
        throw new BadRequestException('未检测到绑定的微信身份，请先在小程序中授权登录');
      }
    }

    // 微信商户单号 <= 32 字符
    const outTradeNo = `WP_${Date.now()}_${randomHex(4)}`;
    const attach = JSON.stringify({ billId, userId });

    if (!this.paymentProvider.createJsapiOrder) {
      throw new BadRequestException('当前支付通道不支持微信 JSAPI 线上支付');
    }

    return this.paymentProvider.createJsapiOrder({
      billId,
      amount: payAmount,
      description: `栖居生活-账单缴费(${bill.billNumber})`,
      openid,
      outTradeNo,
      attach,
    });
  }

  /**
   * 微信支付异步通知回调处理
   */
  async handleNotify(
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<{ code: string; message: string }> {
    if (!this.paymentProvider.verifyAndParseNotify) {
      throw new BadRequestException('当前支付通道不支持微信支付回调解析');
    }

    const resource = await this.paymentProvider.verifyAndParseNotify(headers, body);

    if (resource.tradeState === 'SUCCESS') {
      let billId: string | undefined;

      if (resource.attach) {
        try {
          const parsed = JSON.parse(resource.attach);
          billId = parsed.billId;
        } catch {
          // 容错
        }
      }

      // 如果 attach 无法还原，尝试通过 mockProvider 内存或已有订单还原
      if (!billId && 'getOrder' in this.paymentProvider) {
        const order = (this.paymentProvider as any).getOrder(resource.outTradeNo);
        billId = order?.billId;
      }

      if (!billId) {
        this.logger.error(`微信支付回调无法解析对应的 billId: ${JSON.stringify(resource)}`);
        throw new BadRequestException('支付通知缺少账单关联信息');
      }

      // 幂等入账
      const idempotencyKey = `wechat_pay_${resource.outTradeNo}`;
      await this.billPaymentService.addPayment(
        billId,
        {
          amount: resource.amount,
          paymentMethod: PaymentMethod.WECHAT,
          transactionNumber: resource.transactionId,
          idempotencyKey,
          notes: `微信支付线上缴费 (单号: ${resource.outTradeNo})`,
        },
        'SYSTEM_WECHAT_PAY',
      );

      this.logger.log(
        `微信支付入账成功: 账单=${billId}, 单号=${resource.outTradeNo}, 交易号=${resource.transactionId}`,
      );
    }

    return {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  /**
   * 微信支付主动查单补单
   */
  async queryAndSyncPayment(
    billId: string,
    userId: string,
    userRole: string,
    dto: WechatPayQueryDto,
  ) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          select: { tenantId: true },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    if (userRole === 'TENANT') {
      const userTenant = await this.prisma.tenant.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!userTenant || bill.contract.tenantId !== userTenant.id) {
        throw new ForbiddenException('您无权查询非本人的账单');
      }
    }

    const order = await this.paymentProvider.queryOrder(dto.outTradeNo);
    if (!order) {
      return {
        synced: false,
        message: '未查询到该支付单',
        order: null,
      };
    }

    let synced = false;
    if (order.status === 'SUCCESS' && order.amount) {
      const idempotencyKey = `wechat_pay_${dto.outTradeNo}`;
      const existing = await this.prisma.paymentRecord.findUnique({
        where: { idempotencyKey },
      });

      if (!existing) {
        await this.billPaymentService.addPayment(
          billId,
          {
            amount: order.amount,
            paymentMethod: PaymentMethod.WECHAT,
            transactionNumber: order.transactionId,
            idempotencyKey,
            notes: `微信支付查单自动补入账 (单号: ${dto.outTradeNo})`,
          },
          'SYSTEM_WECHAT_PAY',
        );
        synced = true;
      }
    }

    const updatedBill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        paymentRecords: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return {
      synced,
      order,
      bill: updatedBill,
    };
  }
}
