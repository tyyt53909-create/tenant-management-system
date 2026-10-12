import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
