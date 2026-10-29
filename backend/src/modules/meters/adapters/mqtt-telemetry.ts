import { isISO8601 } from 'class-validator';

/** ADR-003 simulator payload; notes and control fields are never forwarded. */
export interface MqttTelemetry {
  messageId: string;
  meterNumber: string;
  meterType: 'WATER' | 'ELECTRICITY' | 'GAS';
  timestamp: string;
  reading: number;
}

const topicPattern = /^tenant-system\/meters\/(WATER|ELECTRICITY|GAS)\/([A-Za-z0-9_.-]{1,128})\/telemetry$/;
const messagePattern = /^[A-Za-z0-9_.:-]{1,128}$/;

export function parseMqttTelemetry(topic: string, bytes: Buffer): MqttTelemetry {
  const match = topicPattern.exec(topic);
  if (!match || bytes.length > 4096) throw new Error('Invalid telemetry topic or size');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid telemetry JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid telemetry payload');
  const p = value as Record<string, unknown>;
  if (p.meterType !== match[1] || p.meterNumber !== match[2]) throw new Error('Topic and payload identity mismatch');
  if (typeof p.messageId !== 'string' || !messagePattern.test(p.messageId)) throw new Error('Invalid messageId');
  if (typeof p.timestamp !== 'string' || !isISO8601(p.timestamp, { strict: true }) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(p.timestamp) || !Number.isFinite(Date.parse(p.timestamp))) throw new Error('Invalid timestamp');
  if (typeof p.reading !== 'number' || !Number.isFinite(p.reading) || p.reading < 0 || p.reading > 99999999.99 || Math.abs(p.reading * 100 - Math.round(p.reading * 100)) > 1e-6) throw new Error('Invalid reading');
  return { messageId: p.messageId, meterNumber: p.meterNumber as string, meterType: p.meterType as MqttTelemetry['meterType'], timestamp: p.timestamp, reading: p.reading };
}

export interface MqttMeterBinding { meterId: string; buildingId: string; meterNumber: string; meterType: MqttTelemetry['meterType'] }
export interface MqttMeterLookup {
  findUnique(args: { where: { id: string } }): Promise<{ id: string; buildingId: string; meterNumber: string; meterType: string; isActive: boolean } | null>;
}
export interface MqttReadingWriter {
  createReading(meterId: string, dto: { currentReading: number; readingTime: string; messageId: string; source: 'SIMULATED'; autoSettle: false }, operatorId: string): Promise<unknown>;
}

/** Explicit binding is required; never trust a building or meter ID from the payload. */
export async function ingestMqttSimulation(topic: string, payload: Buffer, binding: MqttMeterBinding, meters: MqttMeterLookup, writer: MqttReadingWriter): Promise<unknown> {
  const telemetry = parseMqttTelemetry(topic, payload);
  if (telemetry.meterNumber !== binding.meterNumber || telemetry.meterType !== binding.meterType) throw new Error('Unknown device');
  const meter = await meters.findUnique({ where: { id: binding.meterId } });
  if (!meter || !meter.isActive || meter.buildingId !== binding.buildingId || meter.meterNumber !== binding.meterNumber || meter.meterType !== binding.meterType) throw new Error('Invalid meter binding');
  return writer.createReading(meter.id, { currentReading: telemetry.reading, readingTime: telemetry.timestamp, messageId: telemetry.messageId, source: 'SIMULATED', autoSettle: false }, 'mqtt-simulator');
}
