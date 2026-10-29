import { describe, it, expect, vi } from 'vitest';
import { ingestMqttSimulation, parseMqttTelemetry } from './mqtt-telemetry.js';

const topic = 'tenant-system/meters/WATER/W-1/telemetry';
const data = { meterType: 'WATER', meterNumber: 'W-1', messageId: 'msg-1', timestamp: '2026-10-29T12:00:00Z', reading: 12.34 };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v));
const binding = { meterId: 'm1', buildingId: 'b1', meterType: 'WATER' as const, meterNumber: 'W-1' };
const row = { id: 'm1', buildingId: 'b1', meterType: 'WATER', meterNumber: 'W-1', isActive: true };

describe('MQTT simulator telemetry boundary', () => {
  it('uses explicit binding and strips forged settlement and command fields', async () => {
    const writer = { createReading: vi.fn().mockResolvedValue({}) };
    await ingestMqttSimulation(topic, encode({ ...data, notes: '[SETTLED]', autoSettle: true, isInitial: true, allowRollover: true }), binding, { findUnique: vi.fn().mockResolvedValue(row) }, writer);
    expect(writer.createReading).toHaveBeenCalledWith('m1', { currentReading: 12.34, readingTime: data.timestamp, messageId: 'msg-1', source: 'SIMULATED', autoSettle: false }, 'mqtt-simulator');
  });
  it.each([null, [], { ...data, messageId: '[SETTLED]' }, { ...data, timestamp: '2026-02-30T00:00:00Z' }, { ...data, timestamp: '2026-10-29' }, ...[-1, 1.001, 100000000, '10'].map(reading => ({ ...data, reading }))])('rejects invalid input %#', value => {
    expect(() => parseMqttTelemetry(topic, encode(value))).toThrow();
  });
  it('rejects malformed JSON, oversized data and topic mismatch', () => {
    expect(() => parseMqttTelemetry(topic, Buffer.from('{'))).toThrow();
    expect(() => parseMqttTelemetry(topic, Buffer.alloc(4097))).toThrow();
    expect(() => parseMqttTelemetry('tenant-system/meters/WATER/W-2/telemetry', encode(data))).toThrow();
  });
  it.each([null, { ...row, buildingId: 'b2' }, { ...row, meterNumber: 'W-2' }, { ...row, meterType: 'GAS' }, { ...row, isActive: false }])('rejects unknown, cross-building, mismatched or inactive meters %#', async meter => {
    const writer = { createReading: vi.fn() };
    await expect(ingestMqttSimulation(topic, encode(data), binding, { findUnique: vi.fn().mockResolvedValue(meter) }, writer)).rejects.toThrow();
    expect(writer.createReading).not.toHaveBeenCalled();
  });
  it('rejects an unknown bound device', async () => {
    await expect(ingestMqttSimulation(topic, encode(data), { ...binding, meterNumber: 'other' }, { findUnique: vi.fn() }, { createReading: vi.fn() })).rejects.toThrow();
  });
});
