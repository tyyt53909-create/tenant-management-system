import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BillPaymentService } from '../bill-payment.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.js';
import { CreateRefundDto } from '../dto/create-refund.dto.js';
import { randomHex } from '../../../common/utils/secure-random.js';

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billPaymentService: BillPaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * 申请线上原路退款（管理端）
   */
  async createRefund(
    billId: string,
    paymentId: string,
    dto: CreateRefundDto,
    operatorId: string,
  ) {
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.billId !== billId) {
      throw new NotFoundException('收款记录不存在');
    }

    if (payment.status !== 'CONFIRMED') {
      throw new BadRequestException(`收款记录当前为 ${payment.status} 状态，不可退款`);
    }

    // 统计已申请且处于 PROCESSING 或 SUCCESS 的退款
    const activeRefunds = await this.prisma.refundRecord.findMany({
      where: {
        paymentRecordId: paymentId,
        status: { in: ['PROCESSING', 'SUCCESS'] },
      },
    });

    const totalRefunded = activeRefunds.reduce((sum, r) => sum + r.amount, 0);
    const maxRefundable = payment.amount - totalRefunded;

    if (maxRefundable <= 0) {
      throw new BadRequestException('该笔收款已全额退款，不可继续申请');
    }

    const refundAmount = dto.amount ? Math.min(dto.amount, maxRefundable) : maxRefundable;
    if (dto.amount && dto.amount > maxRefundable) {
      throw new BadRequestException(`退款金额超过可退余额（可退 ${maxRefundable} 分）`);
    }

    // 商户退款单号 (<= 32 字符)
    const outRefundNo = `RF_${Date.now()}_${randomHex(4)}`;

    const refundRecord = await this.prisma.refundRecord.create({
      data: {
        paymentRecordId: payment.id,
        billId,
        outRefundNo,
        amount: refundAmount,
        reason: dto.reason,
        status: 'PROCESSING',
        channel: payment.paymentMethod === 'WECHAT' ? 'WECHAT' : String(payment.paymentMethod),
        operatorId,
      },
    });

    if (!this.paymentProvider.createRefund) {
      throw new BadRequestException('当前支付通道不支持退款操作');
    }

    const outTradeNo = payment.idempotencyKey?.replace(/^wechat_pay_/, '') || undefined;
    const providerResult = await this.paymentProvider.createRefund({
      outRefundNo,
      amount: refundAmount,
      totalAmount: payment.amount,
      transactionId: payment.transactionNumber || undefined,
      outTradeNo,
      reason: dto.reason,
    });

    let reversalRecord = null;
    let updatedBill = null;

    if (providerResult.status === 'SUCCESS') {
      if (providerResult.amount !== refundAmount) throw new BadRequestException('渠道退款金额与申请不一致，需要核对');
      const successAt = providerResult.successTime ? new Date(providerResult.successTime) : undefined;
      if (successAt && Number.isNaN(successAt.getTime())) throw new BadRequestException('渠道退款完成时间无效');
      // 若通道即时返回退款成功（如 mock 测试环境），立即联动财务冲正
      const reversalRes = await this.billPaymentService.applyRefundReversal({
        billId,
        paymentId,
        refundAmount,
        outRefundNo,
        refundId: providerResult.refundId,
        operatorId,
        reason: dto.reason,
        successAt,
        userReceivedAccount: providerResult.userReceivedAccount,
      });
      reversalRecord = reversalRes.reversal;
      updatedBill = reversalRes.bill;

    } else {
      await this.prisma.refundRecord.update({
        where: { id: refundRecord.id },
        data: {
          refundId: providerResult.refundId,
          userReceivedAccount: providerResult.userReceivedAccount,
        },
      });
    }

    return {
      refund: await this.prisma.refundRecord.findUnique({ where: { id: refundRecord.id } }),
      reversal: reversalRecord,
      bill: updatedBill,
    };
  }

  /**
   * 微信支付异步退款通知回调处理
   */
  async handleRefundNotify(
    headers: Record<string, string | string[] | undefined>,
    body: any,
  ): Promise<{ code: string; message: string }> {
    if (!this.paymentProvider.verifyAndParseRefundNotify) {
      throw new BadRequestException('当前支付通道不支持微信退款通知解析');
    }

    const resource = await this.paymentProvider.verifyAndParseRefundNotify(headers, body);
    const refundRecord = await this.prisma.refundRecord.findUnique({
      where: { outRefundNo: resource.outRefundNo },
    });

    if (!refundRecord) {
      this.logger.warn(`收到未知退款单通知: ${resource.outRefundNo}`);
      throw new NotFoundException(`未找到退款记录 ${resource.outRefundNo}`);
    }

    if (refundRecord.status === 'SUCCESS' && resource.refundStatus !== 'SUCCESS') return { code: 'SUCCESS', message: '成功' };

    if (resource.refundStatus === 'SUCCESS') {
      if (resource.amount.refund !== refundRecord.amount) throw new BadRequestException('渠道退款金额与申请不一致，需要核对');
      const successAt = resource.successTime ? new Date(resource.successTime) : undefined;
      if (successAt && Number.isNaN(successAt.getTime())) throw new BadRequestException('渠道退款完成时间无效');
      await this.billPaymentService.applyRefundReversal({
        billId: refundRecord.billId,
        paymentId: refundRecord.paymentRecordId,
        refundAmount: refundRecord.amount,
        outRefundNo: refundRecord.outRefundNo,
        refundId: resource.refundId,
        operatorId: 'SYSTEM_WECHAT_REFUND',
        reason: refundRecord.reason || undefined,
        successAt,
        userReceivedAccount: resource.userReceivedAccount,
      });

      this.logger.log(
        `微信退款冲正成功: 账单=${refundRecord.billId}, 退款单号=${refundRecord.outRefundNo}, 微信退款号=${resource.refundId}`,
      );
    } else if (resource.refundStatus === 'CLOSED' || resource.refundStatus === 'ABNORMAL') {
      await this.prisma.refundRecord.updateMany({
        where: { id: refundRecord.id, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          refundId: resource.refundId,
        },
      });
      this.logger.warn(`微信退款失败/关闭: ${refundRecord.outRefundNo}`);
    }

    return { code: 'SUCCESS', message: '成功' };
  }

  /**
   * 查询账单相关的全部退款记录
   */
  async getBillRefunds(billId: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException('账单不存在');

    return this.prisma.refundRecord.findMany({
      where: { billId },
      orderBy: { createdAt: 'desc' },
      include: {
        paymentRecord: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            transactionNumber: true,
            receiptNumber: true,
          },
        },
      },
    });
  }
}
