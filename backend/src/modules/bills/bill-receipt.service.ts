import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import { summarizeLateFees } from './bills.service.js';

export const BILL_TYPE_LABEL: Record<string, string> = {
  RENT: '租金',
  DEPOSIT: '押金',
  UTILITY: '水电费',
  MAINTENANCE: '维修费',
  CLEANING: '保洁费',
  OTHER: '其他',
};

@Injectable()
export class BillReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  /** 滞纳金未核销余额（分） */
  private lateFeeOutstanding(fee: { confirmedAmount: number | null; settledAmount: number | null }) {
    return Math.max(0, (fee.confirmedAmount ?? 0) - (fee.settledAmount ?? 0));
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

    if (tenantId && (!bill.contract || bill.contract.tenantId !== tenantId)) {
      throw new NotFoundException('收据不存在');
    }

    const lateFeeSummary = summarizeLateFees(bill.lateFees || []);
    const confirmedLateFee = lateFeeSummary.amount ?? 0;
    const totalPayable = bill.amount + confirmedLateFee;
    const paymentRecords = bill.paymentRecords || [];
    const totalPaid = paymentRecords.reduce((sum, p) => sum + p.amount, 0);
    const unpaid = Math.max(0, totalPayable - totalPaid);

    return {
      receiptNumber: `RCP-${bill.billNumber}`,
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
      payments: paymentRecords.map((p) => ({
        id: p.id,
        amount: p.amount,
        amountYuan: centsToYuanString(p.amount),
        paymentMethod: p.paymentMethod,
        transactionNumber: p.transactionNumber,
        paidAt: p.paidAt,
        notes: p.notes,
      })),
      issuedAt: new Date(),
    };
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

    // 金额比对：只认当前待收合计或未缴本金。原账单金额在已有收款后不再算匹配，避免旧单据被当成可全额入账。
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
