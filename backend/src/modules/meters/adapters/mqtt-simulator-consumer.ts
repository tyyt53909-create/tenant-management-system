import { connect, type MqttClient } from 'mqtt';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ingestMqttSimulation, InvalidTelemetryError, type MqttMeterBinding, type MqttMeterLookup, type MqttReadingWriter } from './mqtt-telemetry.js';

/** Explicit opt-in loopback simulator; production brokers and credentials are unsupported. */
export class MqttSimulatorConsumer {
  private client?: MqttClient;
  constructor(private readonly url: string, private readonly binding: MqttMeterBinding, private readonly meters: MqttMeterLookup, private readonly writer: MqttReadingWriter, private readonly report: (message: string) => void = () => {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mqtt:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.username || parsed.password || parsed.pathname !== '' && parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Only explicit loopback MQTT URLs are supported');
    if (!binding.meterId || !binding.buildingId || !/^[A-Za-z0-9_.-]{1,128}$/.test(binding.meterNumber) || !['WATER', 'ELECTRICITY', 'GAS'].includes(binding.meterType)) throw new Error('Invalid simulator binding');
  }

  start(): void {
    if (this.client) throw new Error('Consumer already started');
    const client = connect(this.url, { clientId: `t306-${Buffer.from(this.binding.meterId).toString('hex').slice(0, 40)}`, clean: false, reconnectPeriod: 2000, connectTimeout: 5000, resubscribe: false });
    this.client = client;
    client.on('error', error => this.report(`MQTT error: ${error.message}`));
    client.on('connect', () => client.subscribe(`tenant-system/meters/${this.binding.meterType}/${this.binding.meterNumber}/telemetry`, { qos: 1 }, error => { if (error) this.report(`MQTT subscription failed: ${error.message}`); }));
    // MQTT.js calls this before PUBACK. Invalid payloads are discarded; a storage failure
    // drops the connection without acknowledging so a persistent broker can redeliver.
    client.handleMessage = (packet, done) => {
      void ingestMqttSimulation(packet.topic, packet.payload as Buffer, this.binding, this.meters, this.writer).then(() => done(), error => {
        if (error instanceof InvalidTelemetryError || error instanceof BadRequestException || error instanceof NotFoundException) { this.report(`Rejected telemetry: ${error.message}`); done(); return; }
        this.report(`Telemetry storage failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        client.stream.destroy();
        done(error instanceof Error ? error : new Error('Telemetry storage failed'));
      });
    };
  }

  async stop(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = undefined;
    await new Promise<void>(resolve => client.end(false, {}, () => resolve()));
  }
}
