import { describe, expect, it } from 'vitest';
import { rentDetailLabels, rentPrincipal } from './rentDetail';

describe('租金明细呈现', () => {
  it('未知本金不显示为零，并保留退款和更正负号', () => {
    expect(rentPrincipal(null)).toBe('待核对');
    expect(rentPrincipal(0)).toBe('0');
    expect(rentPrincipal(-10000)).toBe('-10000');
    expect(rentPrincipal(60000)).toBe('60000');
  });
  it('区分收入、成功退款和更正', () => {
    expect(Object.values(rentDetailLabels)).toEqual(['收入 / 预付抵扣', '成功退款', '更正']);
  });
});
