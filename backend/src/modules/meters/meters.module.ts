import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetersService } from './meters.service.js';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { MetersController } from './meters.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { METER_ADAPTER, type MeterAdapter } from './adapters/meter-adapter.js';
import { ManualMeterAdapter, SimulatorMeterAdapter } from './adapters/manual-meter.adapter.js';
import { MeterService } from './meter.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { MeterReadingService } from './meter-reading.service.js';
import { MeterBatchReadingService } from './meter-batch-reading.service.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterUsageQueryService } from './meter-usage-query.service.js';
import { MeterReconciliationService } from './meter-reconciliation.service.js';
import { MeterAnomalySimulationRunner } from './meter-anomaly-simulation.runner.js';

@Module({
  imports: [PrismaModule],
  controllers: [MetersController],
  providers: [
    MeterPriceService,
    MeterBillingService,
    MeterReadingService,
    MeterBatchReadingService,
    MeterUsageQueryService,
    MeterReconciliationService,
    MeterAnomalySimulationRunner,
    {
      provide: MeterService,
      inject: [PrismaService, METER_ADAPTER, MeterPriceService],
      useFactory: (prisma: PrismaService, adapter: MeterAdapter, priceService: MeterPriceService) =>
        new MeterService(prisma, adapter, priceService),
    },
    MetersService,
    MetersSimulatorService,
    {
      provide: METER_ADAPTER,
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, configService: ConfigService) =>
        configService.get<string>('METER_MODE') === 'simulator'
          ? new SimulatorMeterAdapter(prisma)
          : new ManualMeterAdapter(prisma),
    },
  ],
  exports: [
    MetersService,
    MetersSimulatorService,
    MeterAnomalySimulationRunner,
    MeterService,
    MeterPriceService,
    MeterReadingService,
    MeterBatchReadingService,
    MeterBillingService,
    MeterUsageQueryService,
    MeterReconciliationService,
  ],
})
export class MetersModule {}
