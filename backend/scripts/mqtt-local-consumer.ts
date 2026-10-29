/** Explicit local-only simulator. Requires the same marked, non-superuser database as integration tests. */
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { BusinessClock } from '../src/common/business-clock/business-clock.service.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { MeterBillingService } from '../src/modules/meters/meter-billing.service.js';
import { MeterPriceService } from '../src/modules/meters/meter-price.service.js';
import { MeterReadingService } from '../src/modules/meters/meter-reading.service.js';
import { MqttSimulatorConsumer } from '../src/modules/meters/adapters/mqtt-simulator-consumer.js';
import type { MqttMeterBinding } from '../src/modules/meters/adapters/mqtt-telemetry.js';
import { assertIntegrationEnvironment, assertMarkedIntegrationDatabase } from '../test/integration/guard.js';

async function main() {
  if (process.env.MQTT_SIMULATOR_ENABLED !== 'true') throw new Error('MQTT_SIMULATOR_ENABLED=true required');
  const target = assertIntegrationEnvironment(process.env);
  const dbUrl = new URL(target.databaseUrl);
  const redisUrl = new URL(target.redisUrl);
  if (dbUrl.hostname !== '127.0.0.1' || redisUrl.hostname !== '127.0.0.1') throw new Error('Local simulator requires loopback test services');
  const binding = JSON.parse(process.env.MQTT_SIMULATOR_BINDING || 'null') as MqttMeterBinding | null;
  if (!binding || !process.env.MQTT_SIMULATOR_BROKER) throw new Error('Explicit broker and binding required');
  const probe = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    await assertMarkedIntegrationDatabase({ readMarker: () => probe.$queryRawUnsafe<Array<{ token: string; rolsuper: boolean }>>('SELECT m.token, r.rolsuper FROM integration_guard.marker m CROSS JOIN pg_roles r WHERE m.id = 1 AND r.rolname = current_user') }, target.marker);
  } finally { await probe.$disconnect(); }
  const prisma = new PrismaService({ datasources: { db: { url: target.databaseUrl } } });
  const clock = new BusinessClock(new ConfigService());
  const price = new MeterPriceService(prisma, clock);
  const writer = new MeterReadingService(prisma, new MeterBillingService(prisma, clock, price), price);
  const consumer = new MqttSimulatorConsumer(process.env.MQTT_SIMULATOR_BROKER, binding, prisma.meter, writer, message => console.error(message));
  await prisma.$connect();
  consumer.start();
  const stop = async () => { await consumer.stop(); await prisma.$disconnect(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
