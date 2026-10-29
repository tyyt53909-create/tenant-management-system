import { createServer, type Socket } from 'node:net';
import * as packet from 'mqtt-packet';
import { connect } from 'mqtt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { prisma, resetDatabase } from './harness.js';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { MeterPriceService } from '../../src/modules/meters/meter-price.service.js';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { MeterReadingService } from '../../src/modules/meters/meter-reading.service.js';
import { MeterBatchReadingService } from '../../src/modules/meters/meter-batch-reading.service.js';
import { MeterReconciliationService } from '../../src/modules/meters/meter-reconciliation.service.js';
import { MqttSimulatorConsumer } from '../../src/modules/meters/adapters/mqtt-simulator-consumer.js';
import type { PrismaService } from '../../src/modules/prisma/prisma.service.js';

beforeEach(resetDatabase);
afterAll(async () => { await prisma.$disconnect(); });

// Minimal loopback-only broker for the test: supports CONNECT, SUBSCRIBE, QoS1 PUBLISH and PING.
async function broker() {
  const peers = new Set<Socket>();
  const subscriptions = new Set<Socket>();
  let seq = 10;
  const server = createServer(socket => {
    peers.add(socket);
    socket.on('close', () => { peers.delete(socket); subscriptions.delete(socket); });
    const parser = packet.parser();
    socket.on('data', data => parser.parse(data));
    parser.on('packet', (p: any) => {
      if (p.cmd === 'connect') socket.write(packet.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      if (p.cmd === 'subscribe') { subscriptions.add(socket); socket.write(packet.generate({ cmd: 'suback', messageId: p.messageId, granted: [1] })); }
      if (p.cmd === 'publish') {
        for (const sub of subscriptions) sub.write(packet.generate({ cmd: 'publish', topic: p.topic, payload: p.payload, qos: 1, dup: false, retain: false, messageId: seq++ }));
        if (p.qos === 1) socket.write(packet.generate({ cmd: 'puback', messageId: p.messageId }));
      }
      if (p.cmd === 'pingreq') socket.write(packet.generate({ cmd: 'pingresp' }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  return { url: `mqtt://127.0.0.1:${port}`, subscriptions, disconnect: () => { for (const p of peers) p.destroy(); }, close: async () => { for (const p of peers) p.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

async function until(predicate: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for MQTT or database');
}

describe('loopback MQTT simulation and isolated PostgreSQL', () => {
  it('persists QoS1, isolates real readings, rejects invalid devices, and deduplicates resend after reconnect', async () => {
    const building = await prisma.building.create({ data: { name: 'synthetic', floors: 1 } });
    const meter = await prisma.meter.create({ data: { buildingId: building.id, meterNumber: 'W-1', meterType: 'WATER', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const db = prisma as unknown as PrismaService;
    const clock = new BusinessClock(new ConfigService());
    const price = new MeterPriceService(db, clock);
    const writer = new MeterReadingService(db, new MeterBillingService(db, clock, price), price);
    const batch = new MeterBatchReadingService(db, new MeterBillingService(db, clock, price), price);
    const rejected = await batch.createBatchReadings({ readings: [{ meterId: meter.id, currentReading: 999, source: 'SIMULATED' as never }] }, 'synthetic');
    expect(rejected.failureCount).toBe(1);
    await writer.createReading(meter.id, { currentReading: 10, readingTime: '2026-01-01T00:00:00Z', source: 'MANUAL', autoSettle: false }, 'synthetic');
    const beforeMeter = await prisma.meter.findUniqueOrThrow({ where: { id: meter.id } });
    const beforeReal = await prisma.meterReading.findMany({ where: { meterId: meter.id, source: 'MANUAL' } });
    const beforeBills = await prisma.bill.count();
    const beforeTransactions = await prisma.prepayTransaction.count();
    await expect(writer.createReading(meter.id, { currentReading: 999, source: 'SIMULATED', autoSettle: true }, 'synthetic')).rejects.toThrow('模拟读数不能自动结算');
    const b = await broker();
    const consumer = new MqttSimulatorConsumer(b.url, { meterId: meter.id, buildingId: building.id, meterNumber: meter.meterNumber, meterType: 'WATER' }, prisma.meter, writer);
    let publisher = connect(b.url, { reconnectPeriod: 0 });
    const topic = 'tenant-system/meters/WATER/W-1/telemetry';
    const body = { messageId: 'same', meterNumber: 'W-1', meterType: 'WATER', timestamp: '2026-01-02T00:00:00Z', reading: 900, notes: '[SETTLED]' };
    try {
      consumer.start();
      await until(() => b.subscriptions.size === 1 && publisher.connected);
      publisher.publish(topic, JSON.stringify(body), { qos: 1 });
      await until(async () => (await prisma.meterReading.count({ where: { meterId: meter.id, source: 'SIMULATED' } })) === 1);
      b.disconnect();
      await new Promise<void>(resolve => publisher.end(true, () => resolve()));
      publisher = connect(b.url, { reconnectPeriod: 0 });
      await until(() => b.subscriptions.size === 1 && publisher.connected);
      publisher.publish(topic, JSON.stringify(body), { qos: 1 });
      publisher.publish(topic, JSON.stringify({ ...body, meterNumber: 'wrong', messageId: 'invalid' }), { qos: 1 });
      publisher.publish(topic, JSON.stringify({ ...body, messageId: 'old', timestamp: '2025-12-31T00:00:00Z' }), { qos: 1 });
      publisher.publish(topic, JSON.stringify({ ...body, messageId: 'bad-value', reading: -1 }), { qos: 1 });
      await new Promise(r => setTimeout(r, 300));
      expect(await prisma.meterReading.count({ where: { meterId: meter.id, source: 'SIMULATED' } })).toBe(1);
      expect(await prisma.meter.findUniqueOrThrow({ where: { id: meter.id } })).toEqual(beforeMeter);
      expect(await prisma.meterReading.findMany({ where: { meterId: meter.id, source: 'MANUAL' } })).toEqual(beforeReal);
      expect(await prisma.bill.count()).toBe(beforeBills);
      expect(await prisma.prepayTransaction.count()).toBe(beforeTransactions);
      const real = await writer.createReading(meter.id, { currentReading: 12, readingTime: '2026-01-03T00:00:00Z', source: 'MANUAL', autoSettle: false, messageId: 'same' }, 'synthetic');
      expect(Number(real.reading.previousReading)).toBe(10);
      expect(Number(real.reading.usage)).toBe(2);
      expect(await prisma.meterReading.count({ where: { meterId: meter.id, source: 'MANUAL' } })).toBe(2);
      const reconciliation = await new MeterReconciliationService(db, price).reconcile({ period: '2026-01' });
      expect(reconciliation.rows[0].readingUsage).toBe(2);
    } finally { await consumer.stop(); await new Promise<void>(resolve => publisher.end(true, () => resolve())); await b.close(); }
  }, 20000);
});
