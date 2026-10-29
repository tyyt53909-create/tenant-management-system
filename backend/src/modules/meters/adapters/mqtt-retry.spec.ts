import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('mqtt', () => ({ connect: mocks.connect }));
import { MqttSimulatorConsumer } from './mqtt-simulator-consumer.js';
const binding = { meterId: 'm1', buildingId: 'b1', meterNumber: 'W-1', meterType: 'WATER' as const };
class Client extends EventEmitter {
  stream = { destroy: vi.fn() };
  reconnect = vi.fn(); subscribe = vi.fn();
  end = vi.fn((_force: boolean, _opts?: unknown, cb?: () => void) => cb?.());
}
describe('simulator reconnect bounds', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.connect.mockReset(); });
  afterEach(() => vi.useRealTimers());
  it('rejects duplicate instances and stops after five retries', async () => {
    const client = new Client(); mocks.connect.mockReturnValue(client);
    const report = vi.fn();
    const consumer = new MqttSimulatorConsumer('mqtt://127.0.0.1:1883', binding, { findUnique: vi.fn() }, { createReading: vi.fn() }, report);
    const duplicate = new MqttSimulatorConsumer('mqtt://127.0.0.1:1883', binding, { findUnique: vi.fn() }, { createReading: vi.fn() });
    consumer.start(); expect(() => duplicate.start()).toThrow('already active');
    for (const delay of [1000, 2000, 4000, 8000, 16000]) { client.emit('close'); await vi.advanceTimersByTimeAsync(delay); }
    expect(client.reconnect).toHaveBeenCalledTimes(5);
    client.emit('close'); await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith('MQTT retry limit reached; consumer stopped');
    await consumer.stop();
  });
  it('shares a bounded shutdown promise', async () => {
    const client = new Client(); client.end.mockImplementation(() => {}); mocks.connect.mockReturnValue(client);
    const consumer = new MqttSimulatorConsumer('mqtt://127.0.0.1:1883', binding, { findUnique: vi.fn() }, { createReading: vi.fn() });
    consumer.start(); const first = consumer.stop(); expect(consumer.stop()).toBe(first);
    await vi.advanceTimersByTimeAsync(5000); await first; expect(client.end).toHaveBeenCalledWith(true);
  });
});
