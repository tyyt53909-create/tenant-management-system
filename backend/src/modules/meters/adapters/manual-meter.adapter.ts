import { PrismaService } from '../../prisma/prisma.service.js';
import { realMeterReadings } from '../meter-reading-scope.js';
import type { AdapterReading, MeterAdapter } from './meter-adapter.js';

export class ManualMeterAdapter implements MeterAdapter {
  readonly name = 'manual';

  constructor(private readonly prisma: PrismaService) {}

  async fetchReading(meterId: string): Promise<AdapterReading | null> {
    const reading = await this.prisma.meterReading.findFirst({
      where: { meterId, ...realMeterReadings(this.prisma), source: 'MANUAL' },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });
    return reading ? toAdapterReading(reading) : null;
  }
}

export class SimulatorMeterAdapter implements MeterAdapter {
  readonly name = 'simulator';

  constructor(private readonly prisma: PrismaService) {}

  async fetchReading(meterId: string): Promise<AdapterReading | null> {
    const reading = await this.prisma.meterReading.findFirst({
      where: { meterId, ...realMeterReadings(this.prisma), source: 'DEVICE' },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });
    return reading ? toAdapterReading(reading) : null;
  }
}

function toAdapterReading(reading: {
  meterId: string;
  currentReading: { toString(): string } | number;
  readingTime: Date;
  source: string;
}): AdapterReading {
  return {
    meterId: reading.meterId,
    currentReading: Number(reading.currentReading),
    readingTime: reading.readingTime,
    source: reading.source === 'DEVICE' ? 'DEVICE' : 'MANUAL',
  };
}
