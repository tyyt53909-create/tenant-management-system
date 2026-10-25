import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import { summarizeLateFees } from './bills.service.js';
import { buildReceiptPdf, type ReceiptPdfData } from './utils/receipt-pdf.builder.js';

export const BILL_TYPE_LABEL: Record<string, string> = {
  RENT: '租金',
  DEPOSIT: '押金',
  UTILITY: '水电费',
  MAINTENANCE: '维修费',
  CLEANING: '保洁费',
  OTHER: '其他',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  BANK_TRANSFER: '银行转账',
  CASH: '现金',
  OTHER: '其他',
};

@Injectable()
export class BillReceiptService {
  private readonly logger = new Logger(BillReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /** 滞纳金未核销余额（分） */
  private lateFeeOutstanding(fee: { confirmedAmount: number | null; settledAmount: number | null }) {
    return Math.max(0, (fee.confirmedAmount ?? 0) - (fee.settledAmount ?? 0));
  }

  /**
   * 计算收据防伪验真码（HMAC-SHA256 前 16 位大写）
   */
  computeVerifyCode(receiptNumber: string, amount: number, paidAt: Date | string): string {
    const secret =
      this.configService.get<string>('JWT_SECRET') ||
      'qiju-receipt-anti-counterfeit-secret';

    const paidAtStr = typeof paidAt === 'string' ? paidAt : paidAt.toISOString();
    const payload = `${receiptNumber}:${amount}:${paidAtStr}`;

    return createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
  }

  /**
   * 脱敏姓名（张三 -> 张*，李四五 -> 李*五）
   */
  maskName(name?: string | null): string {
    if (!name) return '租客';
    if (name.length <= 1) return name;
    if (name.length === 2) return `${name[0]}*`;
    return `${name[0]}*${name.slice(-1)}`;
  }

  /**
   * 脱敏手机号（13812345678 -> 138****5678）
   */
  maskPhone(phone?: string | null): string {
    if (!phone) return '';
    return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  }

  /**
   * 电子收款收据单据数据聚合（支持租客归属防越权）
   */
  async getReceipt(billId: string, tenantId?: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: {
        contract: {
          include: {
            tenant: true,
            room: {
              include: {
                building: true,
              },
            },
          },
        },
        paymentRecords: {
          orderBy: { paidAt: 'desc' },
        },
        lateFees: {
          where: { confirmedAmount: { not: null } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!bill) {
      throw new NotFoundException('账单不存在');
    }

    if (tenantId !== undefined && (!bill.contract || bill.contract.tenantId !== tenantId)) {
      throw new NotFoundException('收据不存在');
    }

    const lateFeeSummary = summarizeLateFees(bill.lateFees || []);
    const confirmedLateFee = lateFeeSummary.amount ?? 0;
    const totalPayable = bill.amount + confirmedLateFee;
    const paymentRecords = bill.paymentRecords || [];
    const totalPaid = paymentRecords
      .filter((p) => p.status !== 'VOIDED')
      .reduce((sum, p) => sum + p.amount, 0);
    const unpaid = Math.max(0, totalPayable - totalPaid);

    // 主收据编号（优先取最新一笔未作废收款的收据号，否则回退为 RCP-xxx）
    const latestPayment = paymentRecords.find((p) => p.status !== 'VOIDED') || paymentRecords[0];
    const receiptNumber = latestPayment?.receiptNumber || `RCP-${bill.billNumber}`;

    return {
      receiptNumber,
      billId: bill.id,
      billNumber: bill.billNumber,
      payerName: bill.contract?.tenant?.name || '租客',
      payerPhone: bill.contract?.tenant?.phone || '',
      roomNumber: bill.contract?.room?.roomNumber || '',
      buildingName: bill.contract?.room?.building?.name || '',
      period: bill.period,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      principalAmount: bill.amount,
      paidAmount: bill.paidAmount,
      confirmedLateFee,
      totalPayable,
      totalPaid,
      unpaid,
      amountInChinese: centsToChineseRMB(totalPaid > 0 ? totalPaid : bill.paidAmount),
      payments: paymentRecords.map((p) => {
        const verifyCode = p.receiptNumber
          ? this.computeVerifyCode(p.receiptNumber, p.amount, p.paidAt)
          : '';
        return {
          id: p.id,
          receiptNumber: p.receiptNumber,
          amount: p.amount,
          amountYuan: centsToYuanString(p.amount),
          paymentMethod: p.paymentMethod,
          paymentMethodLabel: PAYMENT_METHOD_LABEL[p.paymentMethod] || p.paymentMethod,
          transactionNumber: p.transactionNumber,
          paidAt: p.paidAt,
          status: p.status || 'CONFIRMED',
          isVoided: p.status === 'VOIDED',
          voidedAt: p.voidedAt,
          voidReason: p.voidReason,
          verifyCode,
          notes: p.notes,
        };
      }),
      issuedAt: new Date(),
    };
  }

  /**
   * 获取指定单笔收款记录的收据凭证（支持作废状态呈现与防伪码）
   */
  async getPaymentReceipt(billId: string, paymentId: string, tenantId?: string) {
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { id: paymentId },
      include: {
        bill: {
          include: {
            contract: {
              include: {
                tenant: true,
                room: {
                  include: {
                    building: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment || payment.billId !== billId) {
      throw new NotFoundException('收款记录不存在');
    }

    if (tenantId !== undefined && (!payment.bill.contract || payment.bill.contract.tenantId !== tenantId)) {
      throw new NotFoundException('收据不存在');
    }

    const bill = payment.bill;
    const receiptNumber = payment.receiptNumber || `RCP-${payment.id}`;
    const amountAbs = Math.abs(payment.amount);
    const verifyCode = this.computeVerifyCode(receiptNumber, payment.amount, payment.paidAt);
    const verifyUrl = `/api/public/receipts/${encodeURIComponent(receiptNumber)}/verify?code=${verifyCode}`;

    return {
      receiptNumber,
      paymentId: payment.id,
      billId: bill.id,
      billNumber: bill.billNumber,
      status: payment.status,
      isVoided: payment.status === 'VOIDED',
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      amount: amountAbs,
      amountYuan: centsToYuanString(amountAbs),
      amountInChinese: centsToChineseRMB(amountAbs),
      paymentMethod: payment.paymentMethod,
      paymentMethodLabel: PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod,
      transactionNumber: payment.transactionNumber,
      paidAt: payment.paidAt,
      period: bill.period,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      payerName: bill.contract?.tenant?.name || '租客',
      payerPhone: bill.contract?.tenant?.phone || '',
      buildingName: bill.contract?.room?.building?.name || '',
      roomNumber: bill.contract?.room?.roomNumber || '',
      verifyCode,
      verifyUrl,
      issuedAt: new Date(),
    };
  }

  /**
   * 租客读取名下全部收款收据明细（LSE-05 / T297）
   */
  async findMyReceipts(tenantId?: string) {
    if (!tenantId) {
      return [];
    }

    const payments = await this.prisma.paymentRecord.findMany({
      where: {
        bill: {
          contract: {
            tenantId,
          },
        },
        receiptNumber: { not: null },
      },
      include: {
        bill: {
          include: {
            contract: {
              include: {
                room: {
                  include: {
                    building: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
      take: 50,
    });

    return payments.map((p) => {
      const bill = p.bill;
      const amountAbs = Math.abs(p.amount);
      const verifyCode = p.receiptNumber
        ? this.computeVerifyCode(p.receiptNumber, p.amount, p.paidAt)
        : '';
      const isVoided = p.status === 'VOIDED';

      return {
        paymentId: p.id,
        receiptNumber: p.receiptNumber,
        billId: bill.id,
        billNumber: bill.billNumber,
        billType: bill.billType,
        billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
        period: bill.period,
        amount: amountAbs,
        amountYuan: centsToYuanString(amountAbs),
        amountInChinese: centsToChineseRMB(amountAbs),
        paymentMethod: p.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABEL[p.paymentMethod] || p.paymentMethod,
        transactionNumber: p.transactionNumber,
        paidAt: p.paidAt,
        status: p.status || 'CONFIRMED',
        isVoided,
        voidedAt: p.voidedAt,
        voidReason: p.voidReason,
        roomNumber: bill.contract?.room?.roomNumber || '',
        buildingName: bill.contract?.room?.building?.name || '',
        verifyCode,
        receiptUrl: `/api/bills/${bill.id}/payments/${p.id}/receipt`,
        pdfUrl: `/api/bills/${bill.id}/payments/${p.id}/receipt/pdf`,
        verifyUrl: `/api/public/receipts/${encodeURIComponent(p.receiptNumber || '')}/verify?code=${verifyCode}`,
      };
    });
  }

  /**
   * 公开收据验真查验（@Public()，脱敏展示，支持有效与作废状态查验）
   */
  async verifyReceipt(receiptNumber: string, code?: string) {
    if (!receiptNumber || typeof receiptNumber !== 'string') {
      throw new BadRequestException('收据编号不能为空');
    }

    const payment = await this.prisma.paymentRecord.findUnique({
      where: { receiptNumber },
      include: {
        bill: {
          include: {
            contract: {
              include: {
                tenant: true,
                room: {
                  include: {
                    building: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return {
        valid: false,
        message: '收据编号不存在，请核实防伪单据号',
      };
    }

    const expectedCode = this.computeVerifyCode(receiptNumber, payment.amount, payment.paidAt);

    if (code && code.trim().toUpperCase() !== expectedCode) {
      return {
        valid: false,
        message: '防伪校验码不匹配，谨防伪造单据',
      };
    }

    const bill = payment.bill;
    const amountAbs = Math.abs(payment.amount);
    const isVoided = payment.status === 'VOIDED';

    return {
      valid: true,
      receiptNumber: payment.receiptNumber,
      status: payment.status,
      isVoided,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      message: isVoided ? `该收据已于 ${payment.voidedAt?.toISOString().slice(0, 10)} 作废` : '收据真实有效',
      amount: amountAbs,
      amountYuan: centsToYuanString(amountAbs),
      amountInChinese: centsToChineseRMB(amountAbs),
      billNumber: bill.billNumber,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      paidAt: payment.paidAt,
      paymentMethod: payment.paymentMethod,
      paymentMethodLabel: PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod,
      transactionNumber: payment.transactionNumber,
      buildingName: bill.contract?.room?.building?.name || '',
      roomNumber: bill.contract?.room?.roomNumber || '',
      payerName: this.maskName(bill.contract?.tenant?.name),
      payerPhone: this.maskPhone(bill.contract?.tenant?.phone),
      verifyCode: expectedCode,
      verifiedAt: new Date(),
    };
  }

  /**
   * 生成收据 PDF 二进制文档流
   */
  async generateReceiptPdf(billId: string, paymentId?: string, tenantId?: string): Promise<Buffer> {
    let pdfData: ReceiptPdfData;

    if (paymentId) {
      const pReceipt = await this.getPaymentReceipt(billId, paymentId, tenantId);
      pdfData = {
        receiptNumber: pReceipt.receiptNumber,
        billNumber: pReceipt.billNumber,
        status: pReceipt.status === 'VOIDED' ? 'VOIDED' : 'CONFIRMED',
        isVoided: pReceipt.isVoided,
        voidedAt: pReceipt.voidedAt,
        voidReason: pReceipt.voidReason,
        issuedAt: pReceipt.issuedAt,
        paidAt: pReceipt.paidAt,
        payerName: pReceipt.payerName,
        payerPhone: pReceipt.payerPhone,
        buildingName: pReceipt.buildingName,
        roomNumber: pReceipt.roomNumber,
        billType: pReceipt.billType,
        billTypeLabel: pReceipt.billTypeLabel,
        period: pReceipt.period,
        amount: pReceipt.amount,
        amountYuan: pReceipt.amountYuan,
        amountInChinese: pReceipt.amountInChinese,
        paymentMethod: pReceipt.paymentMethod,
        paymentMethodLabel: pReceipt.paymentMethodLabel,
        transactionNumber: pReceipt.transactionNumber,
        verifyCode: pReceipt.verifyCode,
        verifyUrl: pReceipt.verifyUrl,
      };
    } else {
      const gReceipt = await this.getReceipt(billId, tenantId);
      const latestPayment = gReceipt.payments[0];
      const isVoided = gReceipt.payments.length > 0 && gReceipt.payments.every((p) => p.isVoided);
      const verifyCode = latestPayment?.receiptNumber
        ? this.computeVerifyCode(latestPayment.receiptNumber, gReceipt.totalPaid, latestPayment.paidAt)
        : this.computeVerifyCode(gReceipt.receiptNumber, gReceipt.totalPaid, new Date());

      pdfData = {
        receiptNumber: gReceipt.receiptNumber,
        billNumber: gReceipt.billNumber,
        status: isVoided ? 'VOIDED' : 'CONFIRMED',
        isVoided,
        voidedAt: latestPayment?.voidedAt,
        voidReason: latestPayment?.voidReason,
        issuedAt: gReceipt.issuedAt,
        paidAt: latestPayment?.paidAt || new Date(),
        payerName: gReceipt.payerName,
        payerPhone: gReceipt.payerPhone,
        buildingName: gReceipt.buildingName,
        roomNumber: gReceipt.roomNumber,
        billType: gReceipt.billType,
        billTypeLabel: gReceipt.billTypeLabel,
        period: gReceipt.period,
        amount: gReceipt.totalPaid,
        amountYuan: centsToYuanString(gReceipt.totalPaid),
        amountInChinese: gReceipt.amountInChinese,
        paymentMethod: latestPayment?.paymentMethod || 'MIXED',
        paymentMethodLabel: latestPayment?.paymentMethodLabel || '综合收款',
        transactionNumber: latestPayment?.transactionNumber,
        verifyCode,
        verifyUrl: `/api/public/receipts/${encodeURIComponent(gReceipt.receiptNumber)}/verify?code=${verifyCode}`,
      };
    }

    return buildReceiptPdf(pdfData);
  }

  /**
   * 公开下载已验真收据的 PDF 文档
   */
  async generatePublicReceiptPdf(receiptNumber: string): Promise<Buffer> {
    const payment = await this.prisma.paymentRecord.findUnique({
      where: { receiptNumber },
      include: {
        bill: {
          include: {
            contract: {
              include: {
                tenant: true,
                room: { include: { building: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('收据不存在');
    }

    const bill = payment.bill;
    const amountAbs = Math.abs(payment.amount);
    const verifyCode = this.computeVerifyCode(receiptNumber, payment.amount, payment.paidAt);
    const isVoided = payment.status === 'VOIDED';

    const pdfData: ReceiptPdfData = {
      receiptNumber: payment.receiptNumber || `RCP-${payment.id}`,
      billNumber: bill.billNumber,
      status: isVoided ? 'VOIDED' : 'CONFIRMED',
      isVoided,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      issuedAt: new Date(),
      paidAt: payment.paidAt,
      payerName: this.maskName(bill.contract?.tenant?.name),
      payerPhone: this.maskPhone(bill.contract?.tenant?.phone),
      buildingName: bill.contract?.room?.building?.name || '',
      roomNumber: bill.contract?.room?.roomNumber || '',
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      period: bill.period,
      amount: amountAbs,
      amountYuan: centsToYuanString(amountAbs),
      amountInChinese: centsToChineseRMB(amountAbs),
      paymentMethod: payment.paymentMethod,
      paymentMethodLabel: PAYMENT_METHOD_LABEL[payment.paymentMethod] || payment.paymentMethod,
      transactionNumber: payment.transactionNumber,
      verifyCode,
      verifyUrl: `/api/public/receipts/${encodeURIComponent(receiptNumber)}/verify?code=${verifyCode}`,
    };

    return buildReceiptPdf(pdfData);
  }

  /**
   * 单据快速识别与智能匹配（支持粘贴文本、微信单据码、单号识别）
   */
  async recognizeVoucher(rawInput: string) {
    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
      throw new BadRequestException('请提供需要识别的单据内容或单号');
    }

    const trimmed = rawInput.trim();
    let extractedBillNo = '';
    let extractedAmountCents: number | null = null;

    // 1. 优先匹配标准化识别码：[VOUCHER:BILL-202610-001:250000]
    const voucherTagMatch = trimmed.match(/(?:\[VOUCHER:|VOUCHER:)([A-Za-z0-9_-]+)(?::(\d+))?\]?/i);
    if (voucherTagMatch) {
      extractedBillNo = voucherTagMatch[1];
      if (voucherTagMatch[2]) {
        extractedAmountCents = parseInt(voucherTagMatch[2], 10);
      }
    }

    // 2. 匹配文本中的账单编号：账单编号：BILL-xxx 或 单号：B-xxx
    if (!extractedBillNo) {
      const billNoMatch = trimmed.match(/(?:账单编号|单据编号|单号)[：:\s]*([A-Za-z0-9_-]+)/i);
      if (billNoMatch) {
        extractedBillNo = billNoMatch[1];
      }
    }

    // 3. 若整段文字本身就是单号
    if (!extractedBillNo) {
      const directMatch = trimmed.match(/^(?:BILL-[\w-]+|B\d{6,}[\w-]*|c[a-z0-9]{20,})$/i);
      if (directMatch) {
        extractedBillNo = directMatch[0];
      }
    }

    // 4. 尝试提取金额（若尚未从标签提取）
    if (extractedAmountCents === null) {
      const moneyMatch = trimmed.match(/(?:应缴金额|金额|待缴|¥|￥)[：:\s]*([0-9]+(?:\.[0-9]{1,2})?)/);
      if (moneyMatch) {
        extractedAmountCents = Math.round(parseFloat(moneyMatch[1]) * 100);
      }
    }

    if (!extractedBillNo) {
      throw new BadRequestException('未能从输入内容中识别到有效的账单编号');
    }

    // 5. 查询账单
    const bill = await this.prisma.bill.findFirst({
      where: {
        OR: [
          { billNumber: extractedBillNo },
          { id: extractedBillNo },
        ],
      },
      include: {
        contract: {
          include: {
            tenant: true,
            room: { include: { building: true } },
          },
        },
        paymentRecords: { orderBy: { paidAt: 'desc' }, take: 10 },
        lateFees: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!bill) {
      throw new NotFoundException(`未能找到编号为「${extractedBillNo}」的账单`);
    }

    // 6. 金额计算
    const unpaidAmount = Math.max(0, bill.amount - bill.paidAmount);
    const unsettledFees = (bill.lateFees || []).filter((f) => (f.confirmedAmount ?? 0) > (f.settledAmount ?? 0));
    const outstandingLateFees = unsettledFees.reduce((sum, f) => sum + this.lateFeeOutstanding(f), 0);
    const totalRemaining = unpaidAmount + outstandingLateFees;

    let amountMatchStatus = 'UNKNOWN'; // MATCHED | MISMATCH | UNKNOWN
    if (extractedAmountCents !== null) {
      if (extractedAmountCents === totalRemaining || extractedAmountCents === unpaidAmount) {
        amountMatchStatus = 'MATCHED';
      } else {
        amountMatchStatus = 'MISMATCH';
      }
    }

    return {
      success: true,
      matchedBy: extractedBillNo,
      billId: bill.id,
      billNumber: bill.billNumber,
      billType: bill.billType,
      billTypeLabel: BILL_TYPE_LABEL[bill.billType] || bill.billType,
      period: bill.period,
      status: bill.status,
      isPaid: bill.status === 'PAID',
      isCancelled: bill.status === 'CANCELLED',
      dueDate: bill.dueDate,
      amount: bill.amount,
      amountYuan: centsToYuanString(bill.amount),
      paidAmount: bill.paidAmount,
      paidAmountYuan: centsToYuanString(bill.paidAmount),
      unpaidAmount,
      unpaidAmountYuan: centsToYuanString(unpaidAmount),
      outstandingLateFees,
      outstandingLateFeesYuan: centsToYuanString(outstandingLateFees),
      suggestedAmount: totalRemaining,
      suggestedAmountYuan: centsToYuanString(totalRemaining),
      extractedAmountCents,
      extractedAmountYuan: extractedAmountCents !== null ? centsToYuanString(extractedAmountCents) : null,
      amountMatchStatus,
      tenant: {
        id: bill.contract?.tenant?.id || '',
        name: bill.contract?.tenant?.name || '租客',
        phone: bill.contract?.tenant?.phone || '',
      },
      room: {
        id: bill.contract?.room?.id || '',
        roomNumber: bill.contract?.room?.roomNumber || '—',
        buildingName: bill.contract?.room?.building?.name || '',
      },
      recentPayments: bill.paymentRecords.map((p) => ({
        id: p.id,
        amount: p.amount,
        amountYuan: centsToYuanString(p.amount),
        paymentMethod: p.paymentMethod,
        paidAt: p.paidAt,
      })),
    };
  }
}
