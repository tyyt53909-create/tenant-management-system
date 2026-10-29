import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
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
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

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
    if (!this.paymentProvider.createRefund) throw new BadRequestException('当前支付通道不支持退款操作');
    if (typeof dto.requestKey !== 'string' || dto.requestKey.trim() !== dto.requestKey || dto.requestKey.length < 1 || dto.requestKey.length > 128) {
      throw new BadRequestException('退款请求键必须为 1 至 128 个字符且不能包含首尾空格');
    }
    if (dto.amount !== undefined && (!Number.isSafeInteger(dto.amount) || dto.amount <= 0)) throw new BadRequestException('退款金额必须为正整数');
    const fingerprint = createHash('sha256').update(JSON.stringify([billId, paymentId, operatorId, dto.amount ?? null, dto.reason ?? null])).digest('hex');
    let reservation;
    try {
      reservation = await this.prisma.$transaction(async tx => {
        // 与作废、退款收尾保持一致：先账单行，再原收款行。
        await tx.$queryRaw(Prisma.sql`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM payment_records WHERE id = ${paymentId} FOR UPDATE`);
        const payment = await tx.paymentRecord.findUnique({ where: { id: paymentId } });
        if (!payment || payment.billId !== billId) throw new NotFoundException('收款记录不存在');
        const existing = await tx.refundRecord.findUnique({ where: { requestKey: dto.requestKey }, include: { reversal: true } });
        if (existing) {
          if (existing.requestFingerprint !== fingerprint) throw new ConflictException('退款请求键与原请求不一致');
          return { payment, refundRecord: existing, replay: true };
        }
        if (payment.status !== 'CONFIRMED') throw new BadRequestException(`收款记录当前为 ${payment.status} 状态，不可退款`);
        // 所有既有退款均保留预留：FAILED/CLOSED 也可能收到迟到成功通知。
        const reserved = await tx.refundRecord.aggregate({ where: { paymentRecordId: paymentId }, _sum: { amount: true } });
        const available = payment.amount - (reserved._sum.amount ?? 0);
        if (available <= 0) throw new BadRequestException('该笔收款已无可预留退款额度，需要核对');
        const refundAmount = dto.amount ?? available;
        if (refundAmount > available) throw new BadRequestException(`退款金额超过可退余额（可退 ${available} 分）`);
        const refundRecord = await tx.refundRecord.create({ data: {
          paymentRecordId: payment.id, billId, outRefundNo: `RF_${Date.now()}_${randomHex(4)}`,
          requestKey: dto.requestKey, requestFingerprint: fingerprint, amount: refundAmount,
          reason: dto.reason, status: 'PROCESSING',
          channel: payment.paymentMethod === 'WECHAT' ? 'WECHAT' : String(payment.paymentMethod), operatorId,
        } });
        return { payment, refundRecord, replay: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('退款请求键已被其他请求使用');
      throw error;
    }
    const { payment, refundRecord, replay } = reservation;
    if (replay) return { refund: refundRecord, reversal: 'reversal' in refundRecord ? refundRecord.reversal : null, bill: null, idempotent: true };
    const refundAmount = refundRecord.amount;
    const outRefundNo = refundRecord.outRefundNo;
    const outTradeNo = payment.idempotencyKey?.replace(/^wechat_pay_/, '') || undefined;
    let providerResult;
    try {
      providerResult = await this.paymentProvider.createRefund({
        outRefundNo, amount: refundAmount, totalAmount: payment.amount,
        transactionId: payment.transactionNumber || undefined, outTradeNo, reason: dto.reason,
      });
    } catch {
      // 可能已被渠道执行；不得释放预留或以新单号自动重试。
      throw new ServiceUnavailableException('退款渠道结果不确定，请使用原请求键查询或重试并核对');
    }

    if (providerResult.outRefundNo !== outRefundNo) throw new ConflictException('渠道退款单号不一致，需要核对');
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
      await this.prisma.refundRecord.updateMany({
        where: { id: refundRecord.id, status: 'PROCESSING' },
        data: {
          ...(providerResult.status === 'FAILED' || providerResult.status === 'CLOSED' ? { status: 'FAILED' as const } : {}),
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

    if (refundRecord.refundId && resource.refundId && refundRecord.refundId !== resource.refundId) throw new ConflictException('退款渠道编号与已有记录不一致');
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
        refundId: resource.refundId || undefined,
        operatorId: 'SYSTEM_WECHAT_REFUND',
        reason: refundRecord.reason || undefined,
        successAt,
        userReceivedAccount: resource.userReceivedAccount,
        originalTotal: resource.amount.total > 0 ? resource.amount.total : undefined,
        originalTransactionId: resource.transactionId || undefined,
        originalOutTradeNo: resource.outTradeNo || undefined,
      });

      this.logger.log(
        `微信退款冲正成功: 账单=${refundRecord.billId}, 退款单号=${refundRecord.outRefundNo}, 微信退款号=${resource.refundId}`,
      );
    } else if (resource.refundStatus === 'CLOSED' || resource.refundStatus === 'ABNORMAL') {
      const result = await this.prisma.refundRecord.updateMany({
        where: { id: refundRecord.id, status: 'PROCESSING', ...(resource.refundId ? { OR: [{ refundId: null }, { refundId: resource.refundId }] } : {}) },
        data: { status: 'FAILED', refundId: resource.refundId || undefined },
      });
      if (result.count === 0 && resource.refundId) {
        const latest = await this.prisma.refundRecord.findUnique({ where: { id: refundRecord.id } });
        if (latest?.refundId && latest.refundId !== resource.refundId) throw new ConflictException('退款渠道编号与已有记录不一致');
      }
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
