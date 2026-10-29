import { ApiOkResponse } from '@nestjs/swagger';
import { computeOverdue } from './bill-overdue.util.js';
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Res, Headers } from '@nestjs/common';
import type { Response } from 'express';
import { BillsService } from './bills.service.js';
import { BillPaymentService } from './bill-payment.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { VoidPaymentDto } from './dto/void-payment.dto.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { CreateRefundDto } from './dto/create-refund.dto.js';
import { PrepayPayBillDto } from './dto/prepay-pay-bill.dto.js';
import { WechatJsapiPayDto, WechatPayQueryDto } from './dto/wechat-pay.dto.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';
import { PaymentRefundService } from './payment/payment-refund.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(
    private readonly billsService: BillsService,
    private readonly clock: BusinessClock,
    private readonly wechatPaymentService: WechatPaymentService,
    private readonly paymentRefundService: PaymentRefundService,
    private readonly billPaymentService: BillPaymentService,
  ) {}

  private currentOverdue<T extends { dueDate: Date; status: string; amount: number; paidAmount: number }>(bill: T, today: Date) {
    const open = (['PENDING', 'PARTIAL', 'OVERDUE'].includes(bill.status)) && bill.amount > bill.paidAmount;
    return { ...bill, currentOverdueDays: open ? computeOverdue(bill.dueDate, today).overdueDays : 0 };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createBillDto: CreateBillDto) {
    return this.billsService.create(createBillDto);
  }

  // 账单 CSV 导出（仅管理者）
  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportBills(@Query() query: QueryBillsDto, @Res({ passthrough: true }) res: Response) {
    const csv = await this.billsService.exportBills(query);
    const dateStr = this.clock.formatDate().replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bills-export-${dateStr}.csv"`);
    return csv;
  }

  @Get()
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true, properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true, required: ['currentOverdueDays'], properties: { currentOverdueDays: { type: 'integer', description: '当前业务日逾期天数，非历史截止日' } } } } } } })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async findAll(@Query() query: QueryBillsDto) {
    const today = this.clock.todayUtc();
    const result = await this.billsService.findAll(query);
    return { ...result, data: result.data.map(bill => this.currentOverdue(bill, today)) };
  }

  // 租客查看自己的账单
  @Get('my')
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true, properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true, required: ['currentOverdueDays'], properties: { currentOverdueDays: { type: 'integer', description: '当前业务日逾期天数，非历史截止日' } } } } } } })
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.bill.read')
  async findMy(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryBillsDto) {
    const today = this.clock.todayUtc();
    const user = resolveAuthUser(userParam);
    // 租客只能查看自己的账单
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      const result = await this.billsService.findByTenant(tenantId, query);
      return { ...result, data: result.data.map(bill => this.currentOverdue(bill, today)) };
    }
    // 管理员可以看所有
    const result = await this.billsService.findAll(query);
    return { ...result, data: result.data.map(bill => this.currentOverdue(bill, today)) };
  }

  // 租客查看名下所有电子收款收据列表（T297 / LSE-05）
  @Get('my/receipts')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.bill.read')
  findMyReceipts(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.role === 'TENANT' ? (user.tenantId ?? '') : undefined;
    return this.billsService.findMyReceipts(tenantId);
  }

  // 单据快速识别与智能匹配（仅管理员）
  @Post('recognize')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  recognizeVoucher(@Body() dto: { text?: string; code?: string }) {
    return this.billsService.recognizeVoucher(dto.code || dto.text || '');
  }

  // 电子收款收据单据（租客只能看自己的收据）
  @Get(':id/receipt')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.bill.read')
  getReceipt(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    // 租客角色一律传 tenantId（无租客档案时为空串）：服务端据此 fail-closed，
    // 不能传 undefined —— 那会跳过归属校验（T209）
    const tenantId = user.role === 'TENANT' ? (user.tenantId ?? '') : undefined;
    return this.billsService.getReceipt(id, tenantId);
  }

  // 电子收款收据 PDF 导出
  @Get(':id/receipt/pdf')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.bill.read')
  async getReceiptPdf(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.role === 'TENANT' ? (user.tenantId ?? '') : undefined;
    const pdfBuffer = await this.billsService.generateReceiptPdf(id, undefined, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${id}.pdf"`);
    res.end(pdfBuffer);
  }

  // 单笔收款收据凭单数据
  @Get(':id/payments/:paymentId/receipt')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.bill.read')
  getPaymentReceipt(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.role === 'TENANT' ? (user.tenantId ?? '') : undefined;
    return this.billsService.getPaymentReceipt(id, paymentId, tenantId);
  }

  // 单笔收款收据 PDF 导出
  @Get(':id/payments/:paymentId/receipt/pdf')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.bill.read')
  async getPaymentReceiptPdf(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Res() res: Response,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.role === 'TENANT' ? (user.tenantId ?? '') : undefined;
    const pdfBuffer = await this.billsService.generateReceiptPdf(id, paymentId, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${paymentId}.pdf"`);
    res.end(pdfBuffer);
  }

  @Get(':id')
  @ApiOkResponse({ schema: { type: 'object', additionalProperties: true, required: ['currentOverdueDays'], properties: { currentOverdueDays: { type: 'integer', description: '当前业务日逾期天数，非历史截止日' } } } })
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.bill.read')
  async findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    // 租客需要验证是否是自己的账单
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.currentOverdue(await this.billsService.findOneForTenant(id, tenantId), this.clock.todayUtc());
    }
    return this.currentOverdue(await this.billsService.findOne(id), this.clock.todayUtc());
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateBillDto: UpdateBillDto) {
    return this.billsService.update(id, updateBillDto);
  }

  // 登记收款（管理者）
  @Post(':id/payments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addPayment(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const user = resolveAuthUser(userParam);
    const payload = {
      ...dto,
      idempotencyKey: dto.idempotencyKey ?? idempotencyKey ?? undefined,
    };
    return this.billsService.addPayment(id, payload, user.userId);
  }

  // 作废收款并生成冲正（管理者）
  @Post(':id/payments/:paymentId/void')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  voidPayment(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.billsService.voidPayment(id, paymentId, user.userId, dto.reason);
  }

  // 账单收款流水（管理者）
  @Get(':id/payments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findPayments(@Param('id') id: string) {
    return this.billsService.findPayments(id);
  }

  // 添加/确认滞纳金（管理者）：不带 confirmedAmount 生成建议值，带则确认入账
  @Post(':id/late-fees')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addLateFee(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string, @Body() dto: CreateLateFeeDto) {
    const user = resolveAuthUser(userParam);
    return this.billsService.addLateFee(id, dto, user.userId);
  }

  // 滞纳金记录（管理者，含计算过程）
  @Get(':id/late-fees')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findLateFees(@Param('id') id: string) {
    return this.billsService.findLateFees(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.billsService.remove(id);
  }

  // 微信支付 JSAPI 下单（租客/管理者）
  @Post(':id/pay/wechat-jsapi')
  @UseGuards(RolesGuard)
  @Roles('TENANT', 'ADMIN')
  payWithWechatJsapi(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto?: WechatJsapiPayDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.wechatPaymentService.createJsapiOrder(id, user.userId, user.role, dto);
  }

  // 微信支付主动查单补单（租客/管理者）
  @Post(':id/pay/wechat-query')
  @UseGuards(RolesGuard)
  @Roles('TENANT', 'ADMIN')
  queryWechatPayment(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: WechatPayQueryDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.wechatPaymentService.queryAndSyncPayment(id, user.userId, user.role, dto);
  }

  // 预付余额抵扣账单（租客/管理者）
  @Post(':id/pay/prepay')
  @UseGuards(RolesGuard)
  @Roles('TENANT', 'ADMIN')
  payWithPrepay(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto?: PrepayPayBillDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.billPaymentService.payWithPrepay(id, dto ?? {}, {
      userId: user.userId,
      role: user.role,
      tenantId: user.tenantId,
    });
  }

  // 申请原路退款（仅管理者）
  @Post(':id/payments/:paymentId/refund')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createRefund(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: CreateRefundDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.paymentRefundService.createRefund(id, paymentId, dto, user.userId);
  }

  // 查询账单退款记录（仅管理者）
  @Get(':id/refunds')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getRefunds(@Param('id') id: string) {
    return this.paymentRefundService.getBillRefunds(id);
  }
}
