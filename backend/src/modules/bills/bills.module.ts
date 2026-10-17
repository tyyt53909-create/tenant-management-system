import { Module } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { BillPaymentService } from './bill-payment.service.js';
import { BillLateFeeService } from './bill-late-fee.service.js';
import { BillReceiptService } from './bill-receipt.service.js';
import { BillsController } from './bills.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [BillsController],
  providers: [BillsService, BillPaymentService, BillLateFeeService, BillReceiptService],
  exports: [BillsService, BillPaymentService, BillLateFeeService, BillReceiptService],
})
export class BillsModule {}
