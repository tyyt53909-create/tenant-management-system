import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BusinessClockModule } from '../../common/business-clock/business-clock.module.js';
import { AuditLogModule } from '../audit/audit.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
@Module({ imports: [PrismaModule, BusinessClockModule, AuditLogModule], controllers: [ExpensesController], providers: [ExpensesService] })
export class ExpensesModule {}
