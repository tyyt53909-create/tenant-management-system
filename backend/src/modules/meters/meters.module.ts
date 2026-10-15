import { Module } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { MetersController } from './meters.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [MetersController],
  providers: [MetersService, MetersSimulatorService],
  exports: [MetersService, MetersSimulatorService],
})
export class MetersModule {}
