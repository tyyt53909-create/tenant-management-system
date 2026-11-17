export const METER_TYPE_LABEL: Record<string, string> = {
  ELECTRICITY: '电费',
  WATER: '水费',
  GAS: '燃气费',
};

export function settlesByDefault(source: string, autoSettle: boolean | undefined): boolean {
  return source !== 'SIMULATED' && (autoSettle ?? source !== 'DEVICE');
}
