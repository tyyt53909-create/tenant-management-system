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
  source?: 'MANUAL' | 'DEVICE';
  isInitial?: boolean;
  autoSettle?: boolean;
  messageId?: string;
  allowRollover?: boolean;
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

/** 登記讀數（支持初始底数、自动扣费与乱序去重） */
export const createMeterReading = (
  meterId: string,
  data: MeterReadingPayload
): Promise<MeterReadingResult> => {
  return request.post(`/meters/${meterId}/readings`, data);
};

/** 周期结算指定水电表（采集与结算拆分） */
export const settleMeter = (
  meterId: string,
  data?: { settleUntil?: string; notes?: string }
): Promise<any> => {
  return request.post(`/meters/${meterId}/settle`, data || {});
};

/** 查询水电表未结算用量及预估金额 */
export const getUnsettledUsage = (
  meterId: string,
  params?: { settleUntil?: string }
): Promise<any> => {
  return request.get(`/meters/${meterId}/unsettled-usage`, { params });
};

/** 批量周期结算水电表 */
export const settleBatch = (
  data: { buildingId?: string; meterIds?: string[]; settleUntil?: string; notes?: string }
): Promise<any> => {
  return request.post('/meters/settle-batch', data);
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

export interface UtilitiesOverviewData {
  month: string;
  isDemo: boolean;
  water: {
    usage: number;
    momRate: number;
    count: number;
  };
  electricity: {
    usage: number;
    momRate: number;
    count: number;
  };
  cost: {
    total: number;
    waterCost: number;
    electricityCost: number;
  };
  completion: {
    completedMeters: number;
    totalMeters: number;
    pendingMeters: number;
    status: 'FOLLOW_UP' | 'DONE';
  };
  trend: Array<{
    month: string;
    label: string;
    electricityUsage: number;
    waterUsage: number;
    electricityCost: number;
    waterCost: number;
  }>;
}

export const getUtilitiesOverview = (params?: {
  buildingId?: string;
  month?: string;
}): Promise<UtilitiesOverviewData> => {
  return request.get('/meters/usage-overview', { params });
};

