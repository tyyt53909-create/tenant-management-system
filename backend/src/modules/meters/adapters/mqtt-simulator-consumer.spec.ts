import { describe, expect, it, vi } from 'vitest';
import { MqttSimulatorConsumer } from './mqtt-simulator-consumer.js';

const binding = { meterId: 'meter-1', buildingId: 'building-1', meterNumber: 'W-1', meterType: 'WATER' as const };
const meters = { findUnique: vi.fn() };
const writer = { createReading: vi.fn() };
describe('local simulator connection configuration', () => {
  it.each(['mqtt://localhost:1883', 'mqtt://example.com:1883', 'mqtt://127.0.0.1', 'mqtt://user:pass@127.0.0.1:1883', 'mqtts://127.0.0.1:1883', 'mqtt://127.0.0.1:1883/?x=y'])('rejects non-explicit or non-loopback broker %s', url => {
    expect(() => new MqttSimulatorConsumer(url, binding, meters, writer)).toThrow();
  });
  it('validates binding before any connection', () => {
    expect(() => new MqttSimulatorConsumer('mqtt://127.0.0.1:1883', { ...binding, meterNumber: 'W/2' }, meters, writer)).toThrow();
    expect(() => new MqttSimulatorConsumer('mqtt://127.0.0.1:1883', binding, meters, writer)).not.toThrow();
  });
});
