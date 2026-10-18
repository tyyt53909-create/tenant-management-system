import { describe, expect, it } from 'vitest';
import { isMeterSimulatorEnabled } from './feature-flags.js';

describe('isMeterSimulatorEnabled', () => {
  it('未设置或非 true 时关闭', () => {
    expect(isMeterSimulatorEnabled({})).toBe(false);
    expect(isMeterSimulatorEnabled({ FEATURE_METER_SIMULATOR: 'false' })).toBe(false);
    expect(isMeterSimulatorEnabled({ FEATURE_METER_SIMULATOR: '1' })).toBe(false);
  });

  it('只有 true 才打开', () => {
    expect(isMeterSimulatorEnabled({ FEATURE_METER_SIMULATOR: 'true' })).toBe(true);
  });
});
