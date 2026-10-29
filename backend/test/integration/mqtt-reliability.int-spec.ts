import { createServer } from 'node:net';
import Aedes from 'aedes';
import { connect } from 'mqtt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { prisma, resetDatabase } from './harness.js';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { MeterPriceService } from '../../src/modules/meters/meter-price.service.js';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { MeterReadingService } from '../../src/modules/meters/meter-reading.service.js';
import { MqttSimulatorConsumer } from '../../src/modules/meters/adapters/mqtt-simulator-consumer.js';
import type { PrismaService } from '../../src/modules/prisma/prisma.service.js';

beforeEach(resetDatabase);
afterAll(async () => { await prisma.$disconnect(); });
async function until(predicate: () => Promise<boolean> | boolean, limit = 180) {
  for (let i = 0; i < limit; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timeout waiting for broker or database');
}

describe('MQTT QoS1 persistent-session reliability with Aedes', () => {
  it('rolls back a failed write without PUBACK, redelivers after recovery, and delivers queued offline messages', async () => {
    const building = await prisma.building.create({ data: { name: 'synthetic', floors: 1 } });
    const meter = await prisma.meter.create({ data: { buildingId: building.id, meterNumber: 'W-1', meterType: 'WATER', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const db = prisma as unknown as PrismaService;
    const clock = new BusinessClock(new ConfigService());
    const price = new MeterPriceService(db, clock);
    const actual = new MeterReadingService(db, new MeterBillingService(db, clock, price), price);
    const broker = new Aedes();
    const server = createServer(broker.handle);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `mqtt://127.0.0.1:${(server.address() as { port: number }).port}`;
    const reports: string[] = [];
    const acked: string[] = [];
    let subscribed = false;
    let consumerConnected = false;
    let failWrites = true;
    let releaseAck!: () => void;
    const holdAfterCommit = new Promise<void>(resolve => { releaseAck = resolve; });
    broker.on('subscribe', (_subs, client) => { if (client.id.startsWith('t306-')) subscribed = true; });
    broker.on('client', client => { if (client.id.startsWith('t306-')) consumerConnected = true; });
    broker.on('clientDisconnect', client => { if (client.id.startsWith('t306-')) consumerConnected = false; });
    broker.on('ack', (p, client) => { if (client.id.startsWith('t306-') && p?.payload) acked.push(JSON.parse(p.payload.toString()).messageId); });
    const writer = { createReading: async (...args: Parameters<MeterReadingService['createReading']>) => {
      if (failWrites) {
        await prisma.$transaction(async tx => {
          await tx.meterReading.create({ data: { meterId: meter.id, currentReading: 999, previousReading: 999, usage: 0, source: 'SIMULATED', readingTime: new Date(), dedupKey: 'rollback' } });
          throw new Error('synthetic DB transaction failure');
        });
      }
      const result = await actual.createReading(...args);
      if (args[1].messageId === 'failure') await holdAfterCommit;
      return result;
    } };
    const consumer = new MqttSimulatorConsumer(url, { meterId: meter.id, buildingId: building.id, meterType: 'WATER', meterNumber: 'W-1' }, prisma.meter, writer, message => reports.push(message));
    const publisher = connect(url, { reconnectPeriod: 0 });
    const topic = 'tenant-system/meters/WATER/W-1/telemetry';
    const body = { messageId: 'failure', meterNumber: 'W-1', meterType: 'WATER', timestamp: '2026-01-02T00:00:00Z', reading: 20 };
    try {
      consumer.start();
      await until(() => subscribed && publisher.connected);
      await new Promise<void>((resolve, reject) => publisher.publish(topic, JSON.stringify(body), { qos: 1 }, error => error ? reject(error) : resolve()));
      await until(() => reports.some(m => m.includes('storage failed')) && !consumerConnected);
      expect(acked).not.toContain('failure');
      expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(0);
      failWrites = false;
      await until(async () => (await prisma.meterReading.count({ where: { meterId: meter.id, dedupKey: 'sim-msg:failure' } })) === 1);
      expect(acked).not.toContain('failure');
      releaseAck();
      await until(() => acked.includes('failure'));
      await consumer.stop();
      await until(() => !consumerConnected);
      const offline = { ...body, messageId: 'offline', timestamp: '2026-01-03T00:00:00Z', reading: 21 };
      await new Promise<void>((resolve, reject) => publisher.publish(topic, JSON.stringify(offline), { qos: 1 }, error => error ? reject(error) : resolve()));
      expect(await prisma.meterReading.count({ where: { meterId: meter.id, dedupKey: 'sim-msg:offline' } })).toBe(0);
      consumer.start();
      await until(async () => (await prisma.meterReading.count({ where: { meterId: meter.id, dedupKey: 'sim-msg:offline' } })) === 1);
      await until(() => acked.includes('offline'));
      expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(2);
      await new Promise<void>((resolve, reject) => publisher.publish(topic, JSON.stringify({ ...offline, reading: 99 }), { qos: 1 }, error => error ? reject(error) : resolve()));
      await until(() => reports.some(m => m.includes('不同的读数或时间')));
      expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(2);
      const concurrent = { currentReading: 22, readingTime: '2026-01-04T00:00:00Z', source: 'SIMULATED' as const, autoSettle: false, messageId: 'parallel' };
      const [first, second] = await Promise.all([actual.createReading(meter.id, concurrent, 'test'), actual.createReading(meter.id, concurrent, 'test')]);
      expect(first.reading.id).toBe(second.reading.id);
      await expect(actual.createReading(meter.id, { ...concurrent, currentReading: 23 }, 'test')).rejects.toThrow('不同的读数或时间');
      await expect(actual.createReading(meter.id, { ...concurrent, readingTime: '2026-01-05T00:00:00Z' }, 'test')).rejects.toThrow('不同的读数或时间');
      expect(await prisma.meterReading.count({ where: { meterId: meter.id, dedupKey: 'sim-msg:parallel' } })).toBe(1);
      expect(reports.filter(m => m.includes('storage failed')).length).toBe(1);
    } finally {
      releaseAck();
      await consumer.stop();
      await new Promise<void>(resolve => publisher.end(true, () => resolve()));
      await new Promise<void>(resolve => broker.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30000);
  it('stops after five real delayed retries when database transactions keep failing', async () => {
    const building = await prisma.building.create({ data: { name: 'retry', floors: 1 } });
    const meter = await prisma.meter.create({ data: { buildingId: building.id, meterNumber: 'W-RETRY', meterType: 'WATER', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const broker = new Aedes();
    const server = createServer(broker.handle);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `mqtt://127.0.0.1:${(server.address() as { port: number }).port}`;
    let connected = false; let subscribed = false; let failures = 0; let acknowledgements = 0;
    const reports: string[] = [];
    broker.on('client', c => { if (c.id.startsWith('t306-')) connected = true; });
    broker.on('clientDisconnect', c => { if (c.id.startsWith('t306-')) connected = false; });
    broker.on('subscribe', (_s, c) => { if (c.id.startsWith('t306-')) subscribed = true; });
    broker.on('ack', (_p, c) => { if (c.id.startsWith('t306-')) acknowledgements++; });
    const writer = { createReading: async () => {
      failures++;
      await prisma.$transaction(async tx => {
        await tx.meterReading.create({ data: { meterId: meter.id, currentReading: 99, previousReading: 99, usage: 0, source: 'SIMULATED', readingTime: new Date(), dedupKey: 'rollback-only' } });
        throw new Error('synthetic persistent database failure');
      });
    } };
    const consumer = new MqttSimulatorConsumer(url, { meterId: meter.id, buildingId: building.id, meterType: 'WATER', meterNumber: 'W-RETRY' }, prisma.meter, writer, m => reports.push(m));
    const publisher = connect(url, { reconnectPeriod: 0 });
    try {
      consumer.start(); await until(() => subscribed && publisher.connected);
      const started = Date.now();
      await new Promise<void>((resolve, reject) => publisher.publish('tenant-system/meters/WATER/W-RETRY/telemetry', JSON.stringify({ messageId: 'failure', meterNumber: 'W-RETRY', meterType: 'WATER', timestamp: '2026-01-02T00:00:00Z', reading: 20 }), { qos: 1 }, e => e ? reject(e) : resolve()));
      await until(() => reports.some(m => m.includes('retry limit reached')), 850);
      expect(Date.now() - started).toBeGreaterThanOrEqual(30000);
      expect(failures).toBe(6); expect(acknowledgements).toBe(0); expect(connected).toBe(false);
      expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(0);
      consumer.start(); await until(() => connected); await until(() => failures >= 7);
      await consumer.stop(); expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(0);
    } finally { await consumer.stop(); await new Promise<void>(resolve => publisher.end(true, () => resolve())); await new Promise<void>(resolve => broker.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 60000);

});
