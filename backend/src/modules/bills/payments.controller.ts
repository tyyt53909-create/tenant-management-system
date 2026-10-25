import { Controller, Post, Headers, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly wechatPaymentService: WechatPaymentService) {}

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
}
