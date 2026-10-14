import request from '@/utils/request';
import type { Meter, PaginatedResponse, QueryParams } from '@/types';

export const getMeters = (params: QueryParams): Promise<PaginatedResponse<Meter>> => {
  return request.get('/meters', { params });
};

export const getMeterById = (id: string): Promise<Meter> => {
  return request.get(`/meters/${id}`);
};

export const createMeter = (data: Partial<Meter>) => {
  return request.post('/meters', data);
};

export const updateMeter = (id: string, data: Partial<Meter>) => {
  return request.patch(`/meters/${id}`, data);
};

export const deleteMeter = (id: string) => {
  return request.delete(`/meters/${id}`);
};

// ── 讀數登記（T137）──

export interface MeterReading {
  id: string;
  meterId: string;
  currentReading: string | number;
  previousReading: string | number;
  usage: string | number;
  source: 'MANUAL' | 'DEVICE';
  readingTime: string;
  readBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MeterReadingPayload {
  currentReading: number;
  /** 讀數時間（ISO 字串，缺省為當前時間） */
  readingTime?: string;
  notes?: string;
}

export type ReadingDeduction =
  | { applied: false; reason: string }
  | {
      applied: true;
      amount: number;
      deducted: number;
      shortfall: number;
      prepayTransaction: { id: string } | null;
      bill: { id: string; billNumber: string; amount: number } | null;
    };

export interface MeterReadingResult {
  reading: MeterReading;
  deduction: ReadingDeduction;
}

/** 登記讀數（自動扣費；餘額不足生成 UTILITY 補繳帳單） */
export const createMeterReading = (
  meterId: string,
  data: MeterReadingPayload
): Promise<MeterReadingResult> => {
  return request.post(`/meters/${meterId}/readings`, data);
};

/** 讀數歷史（分頁倒序） */
export const getMeterReadings = (
  meterId: string,
  params?: QueryParams
): Promise<PaginatedResponse<MeterReading>> => {
  return request.get(`/meters/${meterId}/readings`, { params });
};

export interface BatchSheetItem {
  meterId: string;
  meterNumber: string;
  meterType: 'ELECTRICITY' | 'WATER' | 'GAS';
  unitPrice: number;
  buildingId: string;
  buildingName: string;
  roomId: string | null;
  roomNumber: string;
  floor: number | null;
  roomStatus: string | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantPhone: string | null;
  lastReading: number;
  lastReadingTime: string | null;
  lastUsage: number;
  prepayBalance: number | null;
}

export interface BatchReadingSubmitItem {
  meterId: string;
  currentReading: number;
  readingTime?: string;
  notes?: string;
}

export interface BatchReadingResponse {
  total: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    meterId: string;
    meterNumber?: string;
    roomNumber?: string;
    success: boolean;
    currentReading?: number;
    previousReading?: number;
    usage?: number;
    amount?: number;
    deducted?: number;
    shortfall?: number;
    error?: string;
  }>;
}

export const getBatchSheet = (params?: {
  buildingId?: string;
  meterType?: string;
  floor?: number;
}): Promise<BatchSheetItem[]> => {
  return request.get('/meters/batch-sheet', { params });
};

export const submitBatchReadings = (
  readings: BatchReadingSubmitItem[]
): Promise<BatchReadingResponse> => {
  return request.post('/meters/batch-readings', { readings });
};

