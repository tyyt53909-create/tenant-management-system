import { describe, it, expect } from 'vitest';
import { buildReceiptPdf, type ReceiptPdfData } from './receipt-pdf.builder.js';

describe('ReceiptPdfBuilder', () => {
  const baseData: ReceiptPdfData = {
    receiptNumber: 'R20261025000001',
    billNumber: 'BILL-202610-0001',
    status: 'CONFIRMED',
    isVoided: false,
    issuedAt: new Date('2026-10-25T10:00:00Z'),
    paidAt: new Date('2026-10-25T09:30:00Z'),
    payerName: '张三',
    payerPhone: '138****0001',
    buildingName: '栖居青年公寓A栋',
    roomNumber: '302',
    billType: 'RENT',
    billTypeLabel: '租金',
    period: '2026-10',
    amount: 250000,
    amountYuan: '2500.00',
    amountInChinese: '人民币贰仟伍佰元整',
    paymentMethod: 'WECHAT',
    paymentMethodLabel: '微信支付',
    transactionNumber: '420000210202610250001',
    verifyCode: 'A1B2C3D4E5F67890',
    verifyUrl: '/api/public/receipts/R20261025000001/verify?code=A1B2C3D4E5F67890',
  };

  it('builds a valid PDF 1.4 buffer with correct structure', () => {
    const pdfBuffer = buildReceiptPdf(baseData);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);

    const pdfString = pdfBuffer.toString('utf8');
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString).toContain('/Type /Catalog');
    expect(pdfString).toContain('/Type /Pages');
    expect(pdfString).toContain('/Type /Page');
    expect(pdfString).toContain('xref');
    expect(pdfString).toContain('trailer');
    expect(pdfString).toContain('startxref');
    expect(pdfString.trim().endsWith('%%EOF')).toBe(true);
  });

  it('contains expected elements in content stream for valid receipt', () => {
    const pdfBuffer = buildReceiptPdf(baseData);
    const pdfString = pdfBuffer.toString('utf8');

    expect(pdfString).toContain('R20261025000001');
    expect(pdfString).toContain('BILL-202610-0001');
    expect(pdfString).toContain('CONFIRMED');
    expect(pdfString).toContain('A1B2C3D4E5F67890');
    expect(pdfString).toContain('2500.00');
    expect(pdfString).not.toContain('*** VOIDED ***');
  });

  it('renders VOIDED watermark and void reason when isVoided is true', () => {
    const voidedData: ReceiptPdfData = {
      ...baseData,
      status: 'VOIDED',
      isVoided: true,
      voidedAt: new Date('2026-10-25T14:20:00Z'),
      voidReason: '租客重复交款冲正',
    };

    const pdfBuffer = buildReceiptPdf(voidedData);
    const pdfString = pdfBuffer.toString('utf8');

    expect(pdfString).toContain('*** VOIDED ***');
    expect(pdfString).toContain('YI ZUO FEI');
    expect(pdfString).toContain('租客重复交款冲正');
  });
});
