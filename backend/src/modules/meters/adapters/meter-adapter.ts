export interface AdapterReading {
  meterId: string;
  currentReading: number;
  readingTime: Date;
  source: 'MANUAL' | 'DEVICE';
}

export interface MeterAdapter {
  readonly name: string;
  fetchReading(meterId: string): Promise<AdapterReading | null>;
}

export const METER_ADAPTER = Symbol('METER_ADAPTER');
