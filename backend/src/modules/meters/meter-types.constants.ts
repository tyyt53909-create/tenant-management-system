export const METER_TYPE_LABEL: Record<string, string> = {
  ELECTRICITY: '电费',
  WATER: '水费',
  GAS: '燃气费',
};

/** 模拟器读数不进入用量统计和结算。 */
export const NOT_SIMULATED = { not: 'SIMULATED' as const };

export function settlesByDefault(source: string, autoSettle: boolean | undefined): boolean {
  if (autoSettle !== undefined) {
    return autoSettle;
  }
  return source !== 'DEVICE' && source !== 'SIMULATED';
}
