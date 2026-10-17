import { describe, expect, it } from 'vitest';
import { showMeterSimulator } from './feature-flags';

describe('showMeterSimulator', () => {
  it('没有用户或开关未打开时不显示入口', () => {
    expect(showMeterSimulator(null)).toBe(false);
    expect(showMeterSimulator(undefined)).toBe(false);
    expect(showMeterSimulator({})).toBe(false);
    expect(showMeterSimulator({ features: { meterSimulator: false } })).toBe(false);
  });

  it('开关打开时显示入口', () => {
    expect(showMeterSimulator({ features: { meterSimulator: true } })).toBe(true);
  });
});
