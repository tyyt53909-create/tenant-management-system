import { connect, type MqttClient } from 'mqtt';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ingestMqttSimulation, InvalidTelemetryError, type MqttMeterBinding, type MqttMeterLookup, type MqttReadingWriter } from './mqtt-telemetry.js';

// Process-local protection only: separate processes still require operator coordination.
const activeBindings = new Set<string>();
export class MqttSimulatorConsumer {
  private client?: MqttClient;
  private timer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopping = false;
  private stopPromise?: Promise<void>;
  private inflight?: Promise<void>;
  private readonly key: string;
  constructor(private readonly url: string, private readonly binding: MqttMeterBinding, private readonly meters: MqttMeterLookup, private readonly writer: MqttReadingWriter, private readonly report: (message: string) => void = () => {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mqtt:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.username || parsed.password || parsed.pathname !== '' && parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Only explicit loopback MQTT URLs are supported');
    if (!binding.meterId || !binding.buildingId || !/^[A-Za-z0-9_.-]{1,128}$/.test(binding.meterNumber) || !['WATER', 'ELECTRICITY', 'GAS'].includes(binding.meterType)) throw new Error('Invalid simulator binding');
    this.key = `${parsed.host}|${binding.meterId}`;
  }
  start(): void {
    if (this.client || activeBindings.has(this.key)) throw new Error('Simulator binding already active in this process');
    activeBindings.add(this.key);
    this.stopping = false;
    this.stopPromise = undefined;
    this.attempts = 0;
    const clientId = `t306-${createHash('sha256').update(this.binding.meterId).digest('hex').slice(0, 18)}`;
    const client = connect(this.url, { clientId, clean: false, reconnectPeriod: 0, connectTimeout: 5000, resubscribe: false });
    this.client = client;
    client.on('error', error => this.report(`MQTT error: ${error.message}`));
    client.on('connect', () => {
      this.stableTimer = setTimeout(() => { this.attempts = 0; }, 30000);
      client.subscribe(`tenant-system/meters/${this.binding.meterType}/${this.binding.meterNumber}/telemetry`, { qos: 1 }, error => { if (error) this.report(`MQTT subscription failed: ${error.message}`); });
    });
    client.on('close', () => {
      clearTimeout(this.stableTimer);
      if (this.stopping) return;
      if (this.attempts >= 5) {
        this.report('MQTT retry limit reached; consumer stopped');
        void this.stop();
        return;
      }
      const delay = Math.min(1000 * 2 ** this.attempts++, 16000);
      this.timer = setTimeout(() => { if (!this.stopping) client.reconnect(); }, delay);
    });
    client.handleMessage = (packet, done) => {
      const work = ingestMqttSimulation(packet.topic, packet.payload as Buffer, this.binding, this.meters, this.writer).then(() => done(), error => {
        if (error instanceof InvalidTelemetryError || error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) { this.report(`Rejected telemetry: ${error.message}`); done(); return; }
        this.report(`Telemetry storage failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        client.stream.destroy();
        done(error instanceof Error ? error : new Error('Telemetry storage failed'));
      });
      this.inflight = work;
      void work.finally(() => { if (this.inflight === work) this.inflight = undefined; });
    };
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const client = this.client;
    if (!client) return Promise.resolve();
    this.stopping = true;
    clearTimeout(this.timer); clearTimeout(this.stableTimer);
    this.stopPromise = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        (async () => { await this.inflight; await new Promise<void>(resolve => client.end(false, {}, () => resolve())); })(),
        new Promise<void>(resolve => { timeout = setTimeout(() => { this.report('MQTT shutdown timed out; forcing disconnect'); client.end(true); resolve(); }, 5000); }),
      ]);
      clearTimeout(timeout);
      this.client = undefined;
      activeBindings.delete(this.key);
    })();
    return this.stopPromise;
  }
}
