export function showMeterSimulator(
  user: { features?: { meterSimulator?: boolean } } | null | undefined,
): boolean {
  return user?.features?.meterSimulator === true;
}
