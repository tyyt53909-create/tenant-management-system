import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BillsService } from './bills.service.js';
import { BillPaymentService } from './bill-payment.service.js';
import { BillLateFeeService } from './bill-late-fee.service.js';
import { BillReceiptService } from './bill-receipt.service.js';
import { BillsController } from './bills.controller.js';
import { PaymentsController } from './payments.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';
import { MockPaymentProvider } from './payment/mock-payment.provider.js';
import { WechatPaymentProvider } from './payment/wechat-payment.provider.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';
import { PaymentRefundService } from './payment/payment-refund.service.js';
import { PaymentReconciliationService } from './payment/payment-reconciliation.service.js';
import { PrepayModule } from '../prepay/prepay.module.js';

@Module({
  imports: [PrismaModule, ConfigModule, forwardRef(() => PrepayModule)],
  controllers: [BillsController, PaymentsController],
  providers: [
    BillsService,
    BillPaymentService,
    BillLateFeeService,
    BillReceiptService,
    WechatPaymentService,
    PaymentRefundService,
    PaymentReconciliationService,
    {
      // 微信支付直连商户（DEC-04）/ 模拟器通道
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentProvider => {
        const isMock =
          config.get<string>('WECHAT_PAY_MOCK') === 'true' ||
          (config.get<string>('NODE_ENV') !== 'production' &&
            !config.get<string>('WECHAT_PAY_MCH_ID'));

        if (isMock) {
          return new MockPaymentProvider();
        }

        const mchId = config.get<string>('WECHAT_PAY_MCH_ID');
        if (mchId) {
          return new WechatPaymentProvider({
            appId: config.get<string>('WECHAT_APPID') || '',
            mchId,
            serialNo: config.get<string>('WECHAT_PAY_SERIAL_NO'),
            privateKey: config.get<string>('WECHAT_PAY_PRIVATE_KEY'),
            apiV3Key: config.get<string>('WECHAT_PAY_API_V3_KEY'),
            notifyUrl: config.get<string>('WECHAT_PAY_NOTIFY_URL'),
          });
        }

        return new OfflinePaymentProvider();
      },
    },
  ],
  exports: [
    BillsService,
    BillPaymentService,
    BillLateFeeService,
    BillReceiptService,
    WechatPaymentService,
    PaymentRefundService,
    PaymentReconciliationService,
    PAYMENT_PROVIDER,
  ],
})
export class BillsModule {}
