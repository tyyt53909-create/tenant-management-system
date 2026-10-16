import { Module } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { MetersController } from './meters.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { METER_ADAPTER } from './adapters/meter-adapter.js';
import { ManualMeterAdapter, SimulatorMeterAdapter } from './adapters/manual-meter.adapter.js';

@Module({
  imports: [PrismaModule],
  controllers: [MetersController],
  providers: [
    MetersService,
    MetersSimulatorService,
    {
      provide: METER_ADAPTER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        process.env.METER_MODE === 'simulator'
          ? new SimulatorMeterAdapter(prisma)
          : new ManualMeterAdapter(prisma),
    },
  ],
  exports: [MetersService, MetersSimulatorService],
})
export class MetersModule {}
