export const bucketKeys = ['CURRENT', 'DAYS_1_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_91_PLUS'] as const;
export type Key = typeof bucketKeys[number];
type Cell = { amount: number; count: number; billIds: string[] };
type Amounts = { principal: number; principalCount: number; unknownPrincipalCount: number; lateFee: number; lateFeeCount: number; unknownLateFeeCount: number };
export type Group = Amounts & { billType: string; buckets: Record<Key, Cell>; unknownPrincipalIds: string[]; unknownLateFeeIds: string[] };
export type Report = { asOfBusinessDate: string; generatedAt: string; groups: Group[]; totals: Amounts };
const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const integer = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const strings = (x: unknown) => Array.isArray(x) && x.every(item => typeof item === 'string');
const amountKeys = ['principal', 'principalCount', 'unknownPrincipalCount', 'lateFee', 'lateFeeCount', 'unknownLateFeeCount'];
const amounts = (x: unknown) => object(x) && amountKeys.every(key => integer(x[key]));
export function isAgingReport(x: unknown): x is Report {
  return object(x) && typeof x.asOfBusinessDate === 'string' && typeof x.generatedAt === 'string' && amounts(x.totals) && Array.isArray(x.groups) && x.groups.every(g =>
    object(g) && typeof g.billType === 'string' && amounts(g) && strings(g.unknownPrincipalIds) && strings(g.unknownLateFeeIds) && object(g.buckets) && bucketKeys.every(key => {
      const cell = (g.buckets as Record<string, unknown>)[key];
      return object(cell) && integer(cell.amount) && integer(cell.count) && strings(cell.billIds);
    }));
}
