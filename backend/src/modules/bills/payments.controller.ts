import {
  Controller,
  Get,
  Post,
  Headers,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import {
  CurrentUser,
  resolveAuthUser,
  type CurrentUserParam,
} from '../../common/decorators/current-user.decorator.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';
import { PaymentRefundService } from './payment/payment-refund.service.js';
import { PaymentReconciliationService } from './payment/payment-reconciliation.service.js';
import {
  QueryReconciliationBatchesDto,
  ResolveDiscrepancyDto,
  RunReconciliationDto,
} from './dto/reconciliation.dto.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly wechatPaymentService: WechatPaymentService,
    private readonly paymentRefundService: PaymentRefundService,
    private readonly paymentReconciliationService: PaymentReconciliationService,
  ) {}

  /**
   * 微信支付结果通知回调 (API v3)
   */
  @Post('wechat/notify')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWechatNotify(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: any,
  ) {
    return this.wechatPaymentService.handleNotify(headers, body);
  }

  /**
   * 微信退款结果通知回调 (API v3)
   */
  @Post('wechat/refund-notify')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWechatRefundNotify(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: any,
  ) {
    return this.paymentRefundService.handleRefundNotify(headers, body);
  }

  /**
   * 执行日终对账比对（仅管理者）
   */
  @Post('reconciliation/run')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async runReconciliation(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: RunReconciliationDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.paymentReconciliationService.runReconciliation(dto.billDate, user.userId);
  }

  /**
   * 查询对账批次列表（仅管理者）
   */
  @Get('reconciliation/batches')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getReconciliationBatches(@Query() query: QueryReconciliationBatchesDto) {
    return this.paymentReconciliationService.queryBatches(query);
  }

  /**
   * 查询对账批次详情及明细（仅管理者）
   */
  @Get('reconciliation/batches/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getReconciliationBatchDetail(@Param('id') id: string) {
    return this.paymentReconciliationService.getBatchDetail(id);
  }

  /**
   * 处理对账差异项（自动补账 / 人工平账，仅管理者）
   */
  @Post('reconciliation/items/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async resolveReconciliationDiscrepancy(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: ResolveDiscrepancyDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.paymentReconciliationService.resolveDiscrepancy(id, dto, user.userId);
  }
}
