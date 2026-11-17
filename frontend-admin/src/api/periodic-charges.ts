import request from '@/utils/request';

export type ChargeState = 'READY' | 'QUEUED' | 'SETTLED' | 'NO_CHANGE' | 'BLOCKED' | 'FAILED';
interface ChargeResult {
  amount: number;
  reason?: string;
  reasonCode: string;
  retryCondition?: string;
  billId?: string;
  prepayTransactionId?: string;
}
export interface ChargeItem {
  id: string;
  kind: 'RENT' | 'UTILITY';
  label: string;
  state: ChargeState;
  attempts: number;
  review: ChargeResult;
  result: ChargeResult | null;
  notificationState: 'PENDING' | 'DELIVERED' | 'FAILED' | null;
}
export interface ChargeBatch {
  id: string;
  buildingId: string;
  building: { name: string };
  period: string;
  cutoff: string;
  version: number;
}
export interface ChargeBatchDetail extends ChargeBatch {
  items: ChargeItem[];
  bills: { id: string; amount: number; paidAmount: number; status: string }[];
}

export const listChargeBatches = (before?: string): Promise<ChargeBatch[]> => request.get('/periodic-charges', { params: { before } });
export const getChargeBatch = (id: string): Promise<ChargeBatchDetail> => request.get(`/periodic-charges/${id}`);
export const previewCharges = (data: { buildingId: string; cutoff: string }): Promise<ChargeBatchDetail> =>
  request.post('/periodic-charges/preview', data);
export const updateChargeBatch = (batch: ChargeBatch, action: 'recheck' | 'confirm'): Promise<ChargeBatchDetail> =>
  request.post(`/periodic-charges/${batch.id}/${action}`, { version: batch.version });
export const retryChargeNotices = (id: string): Promise<ChargeBatchDetail> =>
  request.post(`/periodic-charges/${id}/notifications/retry`);
export const collectChargeReadings = (readings: { meterId: string; readingTime: string; currentReading: number }[])
  : Promise<{ successCount: number; results: { meterId: string; success: boolean; error?: string }[] }> =>
  request.post('/periodic-charges/collect', { readings });
