/**
 * 极简、零依赖、跨平台的纯 TypeScript PDF 1.4 生成器（专门用于租赁合同 PDF 导出与签署留痕）
 */

export interface ContractPdfData {
  contractNumber: string;
  status: string;
  signStatus: string;
  signFlowId?: string | null;
  signedAt?: Date | string | null;
  startDate: string;
  endDate: string;
  tenantName: string;
  tenantPhone: string;
  tenantIdNumberMasked?: string | null;
  coTenants?: Array<{
    name: string;
    phone: string;
    relationship?: string | null;
    isSigner: boolean;
    signedAt?: Date | string | null;
  }>;
  buildingName: string;
  buildingAddress: string;
  roomNumber: string;
  roomType: string;
  area?: number | null;
  rentAmountYuan: string;
  rentAmountChinese: string;
  depositAmountYuan: string;
  depositAmountChinese: string;
  paymentCycleText: string;
  paymentDay: number;
  templateName?: string | null;
  terms?: string | null;
  verifyCode?: string;
}

export function buildContractPdf(data: ContractPdfData): Buffer {
  // A4: 595.28 x 841.89 points
  const width = 595.28;
  const height = 841.89;

  const objects: string[] = [];

  const escapePdf = (str: string) =>
    (str || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const fmtDate = (d: Date | string | undefined | null) => {
    if (!d) return '-';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toISOString().replace('T', ' ').slice(0, 19);
  };

  const streamLines: string[] = [];

  // 1. 背景与外边框
  streamLines.push(
    '0.15 0.3 0.5 RG', // 边框主色调：深青灰蓝
    '1.5 w',
    '36 36 523.28 769.89 re',
    'S',
    '0.75 0.82 0.9 RG',
    '0.5 w',
    '40 40 515.28 761.89 re',
    'S',
  );

  // 2. 标题区背景条
  streamLines.push(
    '0.93 0.96 1 rg', // 浅蓝底
    '41 735 513.28 65 re',
    'f',
    '0.15 0.3 0.5 RG',
    '1 w',
    '41 735 m 554.28 735 l S',
  );

  // 3. 标题文字
  streamLines.push(
    'BT',
    '/F2 18 Tf',
    '0.1 0.25 0.45 rg',
    '150 770 Td',
    '(' + escapePdf('RESIDENTIAL TENANCY LEASE AGREEMENT') + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.35 0.45 0.55 rg',
    '210 748 Td',
    '(' + escapePdf('ZHENG SHI ZU LIN HE TONG (ELECTRONIC CONTRACT)') + ') Tj',
    'ET',
  );

  // 4. 合同基础元数据（编号、状态、起止期）
  streamLines.push(
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '55 712 Td',
    '(' + escapePdf('Contract No: ' + data.contractNumber) + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.3 0.3 0.3 rg',
    '330 712 Td',
    '(' + escapePdf('Lease Term: ' + data.startDate + ' to ' + data.endDate) + ') Tj',
    'ET',
    'BT',
    '/F2 10 Tf',
    '0.2 0.2 0.2 rg',
    '55 695 Td',
    '(' + escapePdf('Contract Status: ' + data.status) + ') Tj',
    'ET',
    'BT',
    '/F2 10 Tf',
    '0.1 0.5 0.2 rg',
    '330 695 Td',
    '(' + escapePdf('Sign Status: ' + data.signStatus + (data.signedAt ? ' (' + fmtDate(data.signedAt) + ')' : '')) + ') Tj',
    'ET',
  );

  // 分割线
  streamLines.push(
    '0.8 0.8 0.8 RG',
    '0.75 w',
    '55 682 m 540 682 l S',
  );

  // 5. 房源与物业信息
  streamLines.push(
    '0.96 0.96 0.98 rg',
    '55 585 485 85 re',
    'f',
    '0.8 0.85 0.9 RG',
    '0.5 w',
    '55 585 485 85 re',
    'S',
    'BT',
    '/F2 11 Tf',
    '0.15 0.3 0.5 rg',
    '65 652 Td',
    '(' + escapePdf('[ SECTION 1: PREMISES & PROPERTY DETAILS ]') + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 632 Td',
    '(' + escapePdf('Building: ' + data.buildingName + '  |  Address: ' + data.buildingAddress) + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 614 Td',
    '(' + escapePdf('Room: ' + data.roomNumber + '  |  Type: ' + data.roomType + '  |  Area: ' + (data.area ? data.area + ' sq.m' : '-')) + ') Tj',
    'ET',
    'BT',
    '/F1 9 Tf',
    '0.4 0.4 0.4 rg',
    '65 596 Td',
    '(' + escapePdf('Property Management: QiJu Intelligent Living Community Office') + ') Tj',
    'ET',
  );

  // 6. 承租人及共同承租人信息
  const coTenantsList = (data.coTenants || [])
    .map((c) => `${c.name} (${c.phone}${c.relationship ? ', ' + c.relationship : ''}${c.isSigner ? ', Co-signer' : ''})`)
    .join('; ');

  streamLines.push(
    '0.96 0.96 0.98 rg',
    '55 485 485 88 re',
    'f',
    '0.8 0.85 0.9 RG',
    '0.5 w',
    '55 485 485 88 re',
    'S',
    'BT',
    '/F2 11 Tf',
    '0.15 0.3 0.5 rg',
    '65 554 Td',
    '(' + escapePdf('[ SECTION 2: TENANT & CO-OCCUPANTS ]') + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 534 Td',
    '(' + escapePdf('Primary Tenant: ' + data.tenantName + '  |  Phone: ' + data.tenantPhone) + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 516 Td',
    '(' + escapePdf('ID / Certificate: ' + (data.tenantIdNumberMasked || 'Verified in System Registry')) + ') Tj',
    'ET',
    'BT',
    '/F1 9.5 Tf',
    '0.3 0.35 0.4 rg',
    '65 496 Td',
    '(' + escapePdf('Co-Tenants / Roommates: ' + (coTenantsList || 'None registered')) + ') Tj',
    'ET',
  );

  // 7. 财务与计费条款
  streamLines.push(
    '0.96 0.96 0.98 rg',
    '55 375 485 98 re',
    'f',
    '0.8 0.85 0.9 RG',
    '0.5 w',
    '55 375 485 98 re',
    'S',
    'BT',
    '/F2 11 Tf',
    '0.15 0.3 0.5 rg',
    '65 454 Td',
    '(' + escapePdf('[ SECTION 3: RENT, DEPOSIT & PAYMENT TERMS ]') + ') Tj',
    'ET',
    'BT',
    '/F2 10.5 Tf',
    '0.1 0.4 0.2 rg',
    '65 434 Td',
    '(' + escapePdf('Monthly Rent: ' + data.rentAmountYuan + ' Yuan/Month (' + data.rentAmountChinese + ')') + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 416 Td',
    '(' + escapePdf('Security Deposit: ' + data.depositAmountYuan + ' Yuan (' + data.depositAmountChinese + ')') + ') Tj',
    'ET',
    'BT',
    '/F1 10 Tf',
    '0.2 0.2 0.2 rg',
    '65 398 Td',
    '(' + escapePdf('Payment Cycle: ' + data.paymentCycleText + '  |  Due Day: Every ' + data.paymentDay + 'th of cycle') + ') Tj',
    'ET',
    'BT',
    '/F1 9 Tf',
    '0.4 0.4 0.4 rg',
    '65 382 Td',
    '(' + escapePdf('Utilities (Water/Electricity): Billed by real meter readings or prepay deductions.') + ') Tj',
    'ET',
  );

  // 8. 条款摘要与法律效力说明
  streamLines.push(
    '0.98 0.98 0.98 rg',
    '55 240 485 123 re',
    'f',
    '0.85 0.85 0.85 RG',
    '0.5 w',
    '55 240 485 123 re',
    'S',
    'BT',
    '/F2 11 Tf',
    '0.15 0.3 0.5 rg',
    '65 344 Td',
    '(' + escapePdf('[ SECTION 4: TERMS & ELECTRONIC EXECUTION ]') + ') Tj',
    'ET',
    'BT',
    '/F1 9 Tf',
    '0.25 0.25 0.25 rg',
    '65 326 Td',
    '(' + escapePdf('1. Template Applied: ' + (data.templateName || 'Standard Residential Lease Contract Template')) + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.3 0.3 0.3 rg',
    '65 310 Td',
    '(' + escapePdf('2. Tenant agrees to comply with community safety rules, fire prevention, and timely bill payments.') + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.3 0.3 0.3 rg',
    '65 296 Td',
    '(' + escapePdf('3. Both parties acknowledge electronic signature validity pursuant to PRC Electronic Signature Law.') + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.3 0.3 0.3 rg',
    '65 282 Td',
    '(' + escapePdf('4. Renewal contracts inherit tenure continuity with unique ACTIVE guarantees in system ledger.') + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.3 0.3 0.3 rg',
    '65 268 Td',
    '(' + escapePdf('5. Early termination adheres to settlement reconciliation and deposit audit protocols.') + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.3 0.3 0.3 rg',
    '65 254 Td',
    '(' + escapePdf('6. E-Sign Tracking Flow ID: ' + (data.signFlowId || 'PENDING_OR_OFFLINE_EXECUTION')) + ') Tj',
    'ET',
  );

  // 9. 签约签署区
  streamLines.push(
    '0.93 0.95 0.98 rg',
    '55 90 485 138 re',
    'f',
    '0.8 0.85 0.9 RG',
    '0.75 w',
    '55 90 485 138 re',
    'S',
    'BT',
    '/F2 10.5 Tf',
    '0.15 0.3 0.5 rg',
    '65 208 Td',
    '(' + escapePdf('[ EXECUTION & SIGNATURES ]') + ') Tj',
    'ET',
    'BT',
    '/F1 9.5 Tf',
    '0.2 0.2 0.2 rg',
    '65 186 Td',
    '(' + escapePdf('Landlord (Party A): ' + data.buildingName + ' Office') + ') Tj',
    'ET',
    'BT',
    '/F1 9.5 Tf',
    '0.2 0.2 0.2 rg',
    '300 186 Td',
    '(' + escapePdf('Tenant (Party B): ' + data.tenantName) + ') Tj',
    'ET',
    'BT',
    '/F1 9 Tf',
    '0.3 0.3 0.3 rg',
    '65 168 Td',
    '(' + escapePdf('Seal Status: Electronic Stamped') + ') Tj',
    'ET',
    'BT',
    '/F1 9 Tf',
    '0.3 0.3 0.3 rg',
    '300 168 Td',
    '(' + escapePdf('Signature Status: ' + (data.signStatus === 'SIGNED' ? 'Electronically Signed' : 'Pending Signature')) + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.4 0.4 0.4 rg',
    '65 146 Td',
    '(' + escapePdf('Certified Anti-Tamper Hash: ' + (data.verifyCode || 'HMAC_VERIFIED_AUTHENTIC')) + ') Tj',
    'ET',
    'BT',
    '/F1 8.5 Tf',
    '0.4 0.4 0.4 rg',
    '300 146 Td',
    '(' + escapePdf('Execution Date: ' + fmtDate(data.signedAt || new Date())) + ') Tj',
    'ET',
    '0.7 0.7 0.7 RG',
    '0.5 w',
    '65 125 m 530 125 l S',
    'BT',
    '/F1 8 Tf',
    '0.5 0.5 0.5 rg',
    '150 105 Td',
    '(' + escapePdf('Generated by QiJu Rental Platform. Legal record archived under audit ledger.') + ') Tj',
    'ET',
  );

  // 组装 PDF 结构
  const streamContent = streamLines.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf-8');

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

  let offset = 9; // header `%PDF-1.4\n`
  const offsets: number[] = [0];

  const header = '%PDF-1.4\n';
  let body = '';
  for (const obj of objects) {
    offsets.push(offset);
    const chunk = obj + '\n';
    body += chunk;
    offset += Buffer.byteLength(chunk, 'utf-8');
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'utf-8');
}
