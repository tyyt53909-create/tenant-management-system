import { Module } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { BillPaymentService } from './bill-payment.service.js';
import { BillLateFeeService } from './bill-late-fee.service.js';
import { BillReceiptService } from './bill-receipt.service.js';
import { BillsController } from './bills.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';

@Module({
  imports: [PrismaModule],
  controllers: [BillsController],
  providers: [
    BillsService,
    BillPaymentService,
    BillLateFeeService,
    BillReceiptService,
    {
      // 当前只有线下收款通道；接入微信支付时在这里换实现，调用方无需改动。
      provide: PAYMENT_PROVIDER,
      useFactory: (): PaymentProvider => new OfflinePaymentProvider(),
    },
  ],
  exports: [BillsService, BillPaymentService, BillLateFeeService, BillReceiptService],
})
export class BillsModule {}
