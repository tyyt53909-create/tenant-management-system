import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { CheckoutController } from './checkout.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
