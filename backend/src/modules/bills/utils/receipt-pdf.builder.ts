/**
 * 极简、零依赖、跨平台的纯 TypeScript PDF 1.4 生成器（专门用于电子收据与凭单导出）
 */

export interface ReceiptPdfData {
  receiptNumber: string;
  billNumber: string;
  status: 'CONFIRMED' | 'VOIDED';
  isVoided: boolean;
  voidedAt?: Date | string | null;
  voidReason?: string | null;
  issuedAt: Date | string;
  paidAt: Date | string;
  payerName: string;
  payerPhone?: string;
  buildingName: string;
  roomNumber: string;
  billType: string;
  billTypeLabel: string;
  period: string;
  amount: number; // 分
  amountYuan: string;
  amountInChinese: string;
  paymentMethod: string;
  paymentMethodLabel: string;
  transactionNumber?: string | null;
  verifyCode: string;
  verifyUrl: string;
}

export function buildReceiptPdf(data: ReceiptPdfData): Buffer {
  // A4: 595.28 x 841.89 points
  const width = 595.28;
  const height = 841.89;

  const objects: string[] = [];

  // 辅助：转义 PDF 文本中的保留字符
  const escapePdf = (str: string) =>
    (str || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  // 格式化日期为 YYYY-MM-DD HH:mm:ss
  const fmtDate = (d: Date | string | undefined | null) => {
    if (!d) return '-';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toISOString().replace('T', ' ').slice(0, 19);
  };

  const streamLines: string[] = [];

  // 1. 背景与外边框
  streamLines.push(
    '0.2 0.4 0.6 RG', // 边框主色调：深蓝灰
    '1.5 w',
    '36 36 523.28 769.89 re',
    'S',
    '0.8 0.85 0.9 RG',
    '0.5 w',
    '40 40 515.28 761.89 re',
    'S',
  );

  // 2. 标题区背景条
  streamLines.push(
    '0.95 0.97 1 rg', // 浅蓝背景
    '41 730 513.28 69 re',
    'f',
    '0.2 0.4 0.6 RG',
    '1 w',
    '41 730 m 554.28 730 l S',
  );

  // 3. 标题文字
  streamLines.push(
    'BT',
    '/F2 20 Tf',
    '0.1 0.25 0.45 rg',
    '180 765 Td',
    '(' + escapePdf('HOUSE RENTAL PAYMENT RECEIPT') + ') Tj',
    'ET',
    'BT',
    '/F1 11 Tf',
    '0.4 0.45 0.5 rg',
    '225 745 Td',
    '(' + escapePdf('DIAN ZI SHOU KUAN SHOU JU') + ') Tj',
    'ET',
  );

  // 4. 收据元信息（收据号、防伪码、开具日期、状态）
  streamLines.push(
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '55 705 Td',
    '(' + escapePdf('Receipt No: ' + data.receiptNumber) + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.3 0.3 0.3 rg',
    '340 705 Td',
    '(' + escapePdf('Date: ' + fmtDate(data.issuedAt)) + ') Tj',
    'ET',
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '55 688 Td',
    '(' + escapePdf('Bill No: ' + data.billNumber) + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.1 0.4 0.8 rg',
    '340 688 Td',
    '(' + escapePdf('Verify Code: ' + data.verifyCode) + ') Tj',
    'ET',
  );

  // 5. 分割线
  streamLines.push(
    '0.8 0.8 0.8 RG',
    '0.75 w',
    '55 675 m 540 675 l S',
  );

  // 6. 租客与房源信息栅格
  streamLines.push(
    '0.98 0.98 0.98 rg',
    '55 605 485 60 re',
    'f',
    '0.85 0.85 0.85 RG',
    '0.5 w',
    '55 605 485 60 re',
    'S',
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '70 645 Td',
    '(' + escapePdf('Tenant (Payer): ' + data.payerName + (data.payerPhone ? ' (' + data.payerPhone + ')' : '')) + ') Tj',
    'ET',
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '70 620 Td',
    '(' + escapePdf('Room / Property: ' + data.buildingName + ' - Room ' + data.roomNumber) + ') Tj',
    'ET',
  );

  // 7. 费用明细表格
  // 表头
  streamLines.push(
    '0.9 0.93 0.97 rg',
    '55 565 485 24 re',
    'f',
    '0.2 0.4 0.6 RG',
    '0.75 w',
    '55 565 485 24 re',
    'S',
    'BT',
    '/F2 10 Tf',
    '0.15 0.3 0.5 rg',
    '65 573 Td (' + escapePdf('Item / Purpose') + ') Tj',
    '150 0 Td (' + escapePdf('Period') + ') Tj',
    '120 0 Td (' + escapePdf('Payment Method') + ') Tj',
    '100 0 Td (' + escapePdf('Amount (CNY)') + ') Tj',
    'ET',
  );

  // 表格数据行
  streamLines.push(
    '0.85 0.85 0.85 RG',
    '0.5 w',
    '55 530 485 35 re',
    'S',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 544 Td (' + escapePdf(data.billTypeLabel + ' (' + data.billType + ')') + ') Tj',
    '150 0 Td (' + escapePdf(data.period) + ') Tj',
    '120 0 Td (' + escapePdf(data.paymentMethodLabel) + ') Tj',
    '/F2 11 Tf',
    '0.1 0.4 0.2 rg',
    '100 0 Td (' + escapePdf('¥ ' + data.amountYuan) + ') Tj',
    'ET',
  );

  // 流水号说明（如果有）
  if (data.transactionNumber) {
    streamLines.push(
      'BT',
      '/F1 8 Tf',
      '0.5 0.5 0.5 rg',
      '65 515 Td (' + escapePdf('Transaction Ref: ' + data.transactionNumber) + ') Tj',
      'ET',
    );
  }

  // 8. 金额汇总高亮条
  streamLines.push(
    '0.96 0.98 0.96 rg',
    '55 460 485 45 re',
    'f',
    '0.3 0.6 0.3 RG',
    '1 w',
    '55 460 485 45 re',
    'S',
    'BT',
    '/F2 11 Tf',
    '0.2 0.2 0.2 rg',
    '70 480 Td (' + escapePdf('Total Paid (RMB): ' + data.amountInChinese) + ') Tj',
    'ET',
    'BT',
    '/F2 14 Tf',
    '0.8 0.1 0.1 rg',
    '380 478 Td (' + escapePdf('¥ ' + data.amountYuan) + ') Tj',
    'ET',
  );

  // 9. 状态印章与防伪验真提示
  if (data.isVoided) {
    // 作废状态：红框与作废大印章
    streamLines.push(
      '0.9 0.1 0.1 RG',
      '2 w',
      '370 320 150 55 re',
      'S',
      'BT',
      '/F2 16 Tf',
      '0.9 0.1 0.1 rg',
      '390 350 Td (' + escapePdf('*** VOIDED ***') + ') Tj',
      'ET',
      'BT',
      '/F1 9 Tf',
      '0.8 0.1 0.1 rg',
      '385 332 Td (' + escapePdf('YI ZUO FEI (CANCELLED)') + ') Tj',
      'ET',
    );
    if (data.voidReason || data.voidedAt) {
      streamLines.push(
        'BT',
        '/F1 9 Tf',
        '0.8 0.1 0.1 rg',
        '70 435 Td (' + escapePdf('Voided At: ' + fmtDate(data.voidedAt) + ' | Reason: ' + (data.voidReason || 'None')) + ') Tj',
        'ET',
      );
    }
  } else {
    // 正常有效状态：绿色财务收据专用章印
    streamLines.push(
      '0.15 0.5 0.25 RG',
      '1.5 w',
      '380 320 140 55 re',
      'S',
      'BT',
      '/F2 12 Tf',
      '0.15 0.5 0.25 rg',
      '405 352 Td (' + escapePdf('CONFIRMED') + ') Tj',
      'ET',
      'BT',
      '/F1 9 Tf',
      '0.2 0.5 0.3 rg',
      '400 334 Td (' + escapePdf('OFFICIAL RECEIPT') + ') Tj',
      'ET',
    );
  }

  // 10. 底部说明与验真二维码/链接说明
  streamLines.push(
    '0.85 0.85 0.85 RG',
    '0.5 w',
    '55 280 m 540 280 l S',
    'BT',
    '/F2 9 Tf',
    '0.3 0.3 0.3 rg',
    '55 255 Td (' + escapePdf('Anti-Counterfeit Verification Notice:') + ') Tj',
    'ET',
    'BT',
    '/F1 8 Tf',
    '0.45 0.45 0.45 rg',
    '55 240 Td (' + escapePdf('1. This receipt is an official proof of payment generated automatically by the Tenant System.') + ') Tj',
    'ET',
    'BT',
    '/F1 8 Tf',
    '0.45 0.45 0.45 rg',
    '55 225 Td (' + escapePdf('2. To verify the authenticity, query online: ' + data.verifyUrl) + ') Tj',
    'ET',
    'BT',
    '/F1 8 Tf',
    '0.45 0.45 0.45 rg',
    '55 210 Td (' + escapePdf('3. Verification Code: ' + data.verifyCode + ' (Tampering invalidates this document).') + ') Tj',
    'ET',
    'BT',
    '/F1 8 Tf',
    '0.6 0.6 0.6 rg',
    '210 55 Td (' + escapePdf('QiJu Tenant Management System - Official Receipt Document') + ') Tj',
    'ET',
  );

  const streamContent = streamLines.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf8');

  // 构建 PDF 1.4 对象体
  // 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  // 3: Page
  objects.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj`,
  );
  // 4: Regular Font (Helvetica)
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj');
  // 5: Bold Font (Helvetica-Bold)
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj',
  );
  // 6: Contents Stream
  objects.push(`6 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj`);

  // 计算 xref 交叉引用表
  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [0]; // 0 号对象固定为 0

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output, 'utf8'));
    output += objects[i] + '\n';
  }

  const xrefOffset = Buffer.byteLength(output, 'utf8');
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    output += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(output, 'utf8');
}
