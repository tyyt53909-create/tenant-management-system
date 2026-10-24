import request from '@/utils/request';

/** 业务设置中心（FIN-11 / T276）。 */

export interface SettingItem<T = unknown> {
  key: string;
  description: string;
  value: T;
  defaultValue: T;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface LateFeeRuleValue {
  graceDays: number;
  dailyRate: number | null;
  fixedDaily: number | null;
  cap: number | null;
}

export type MeterTypeValue = 'ELECTRICITY' | 'WATER' | 'GAS';

export interface MeterDefaultPrice {
  meterType: MeterTypeValue;
  unitPrice: number | null;
  effectiveDate: string | null;
}

export const getSettings = (): Promise<SettingItem[]> => request.get('/settings');

export const getSetting = <T = unknown>(key: string): Promise<SettingItem<T>> =>
  request.get(`/settings/${encodeURIComponent(key)}`);

export const updateSetting = <T = unknown>(key: string, value: T): Promise<SettingItem<T>> =>
  request.patch(`/settings/${encodeURIComponent(key)}`, { value });

export const getMeterDefaultPrices = (): Promise<MeterDefaultPrice[]> =>
  request.get('/meters/price-defaults');

export const setMeterDefaultPrice = (data: {
  meterType: MeterTypeValue;
  unitPrice: number;
  effectiveDate: string;
}): Promise<{ unitPrice: number }> => request.post('/meters/price-defaults', data);
