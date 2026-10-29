import { describe, expect, it } from 'vitest';
import { bucketKeys, isAgingReport, agingParams, requestGeneration } from './agingReport';
const counts = { principal:0, principalCount:0, unknownPrincipalCount:0, lateFee:0, lateFeeCount:0, unknownLateFeeCount:0 };
const report = () => ({ asOfBusinessDate:'2026-10-29', generatedAt:'2026-10-29T00:00:00Z', totals:counts, groups:[{ ...counts, billType:'RENT', unknownPrincipalIds:[], unknownLateFeeIds:[], buckets:Object.fromEntries(bucketKeys.map(k => [k,{amount:0,count:0,billIds:[]}])) }] });
describe('aging response validation', () => {
  it('accepts a complete zero report', () => expect(isAgingReport(report())).toBe(true));
  it('rejects missing or null amounts rather than displaying zero', () => {
    const r = report(); r.groups[0].buckets.CURRENT.amount = null as any;
    expect(isAgingReport(r)).toBe(false); expect(isAgingReport(null)).toBe(false);
  });
});

it('maps both filters and invalidates stale responses on each change', () => {
  expect(agingParams('ALL', '')).toEqual({});
  expect(agingParams('UTILITY', 'building-1')).toEqual({billType:'UTILITY', buildingId:'building-1'});
  const generation = requestGeneration();
  const first = generation.next(); const second = generation.next();
  expect(generation.isCurrent(first)).toBe(false); expect(generation.isCurrent(second)).toBe(true);
});
