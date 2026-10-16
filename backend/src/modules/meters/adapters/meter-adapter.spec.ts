import { describe, expect, it, vi } from 'vitest';
import { ManualMeterAdapter, SimulatorMeterAdapter } from './manual-meter.adapter.js';

describe('MeterAdapter', () => {
  const reading = {
    meterId: 'meter-1',
    currentReading: 120,
    readingTime: new Date('2026-10-01T00:00:00Z'),
    source: 'MANUAL',
  };

  it('手动适配器只取 MANUAL 读数', async () => {
    const prisma = { meterReading: { findFirst: vi.fn().mockResolvedValue(reading) } };
    const adapter = new ManualMeterAdapter(prisma as never);

    await expect(adapter.fetchReading('meter-1')).resolves.toMatchObject({
      currentReading: 120,
      source: 'MANUAL',
    });
    expect(prisma.meterReading.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { meterId: 'meter-1', source: 'MANUAL' },
    }));
  });

  it('模拟器适配器只取 DEVICE 读数', async () => {
    const prisma = {
      meterReading: {
        findFirst: vi.fn().mockResolvedValue({ ...reading, source: 'DEVICE' }),
      },
    };
    const adapter = new SimulatorMeterAdapter(prisma as never);

    await expect(adapter.fetchReading('meter-1')).resolves.toMatchObject({ source: 'DEVICE' });
    expect(prisma.meterReading.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { meterId: 'meter-1', source: 'DEVICE' },
    }));
  });
});
