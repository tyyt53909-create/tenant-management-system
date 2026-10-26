import { normalizeLateFeeRule, type NormalizedLateFeeRule } from '../bills/utils/late-fee.util.js';

/**
 * 业务设置注册表（FIN-11 / T276）。
 *
 * 只允许这里声明的 key 被读写；每个 key 自带默认值与归一化函数。
 * 新增设置必须先登记并写测试，禁止在业务代码里直接写 `systemSetting` 查询。
 */

export class SettingValidationError extends Error {}

export interface SettingDefinition<T> {
  key: string;
  description: string;
  defaultValue: T;
  normalize(raw: unknown): T;
}

const LATE_FEE_FIELDS = new Set(['graceDays', 'dailyRate', 'fixedDaily', 'cap']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireInteger(value: unknown, field: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new SettingValidationError(`${field} 必须是 ${min}–${max} 的整数`);
  }
  return number;
}

/**
 * 默认滞纳金规则：允许空规则（不计收），也允许部分字段。
 * 未知字段直接拒绝，避免把拼写错误静默存进数据库。
 */
export function normalizeDefaultLateFeeRule(raw: unknown): NormalizedLateFeeRule {
  if (raw === null || raw === undefined || raw === '') {
    return normalizeLateFeeRule({});
  }
  if (!isPlainObject(raw)) {
    throw new SettingValidationError('滞纳金规则必须是对象');
  }
  for (const key of Object.keys(raw)) {
    if (!LATE_FEE_FIELDS.has(key)) {
      throw new SettingValidationError(`未知的滞纳金字段：${key}`);
    }
  }

  const graceDays = raw.graceDays === undefined || raw.graceDays === null
    ? 0
    : requireInteger(raw.graceDays, 'graceDays', 0, 365);

  let dailyRate: number | null = null;
  if (raw.dailyRate !== undefined && raw.dailyRate !== null) {
    const value = Number(raw.dailyRate);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new SettingValidationError('dailyRate 必须是 0–1 之间的小数（如 0.003 表示 0.3%/天）');
    }
    dailyRate = value;
  }

  let fixedDaily: number | null = null;
  if (raw.fixedDaily !== undefined && raw.fixedDaily !== null) {
    fixedDaily = requireInteger(raw.fixedDaily, 'fixedDaily', 0, 10_000_000);
  }

  let cap: number | null = null;
  if (raw.cap !== undefined && raw.cap !== null) {
    cap = requireInteger(raw.cap, 'cap', 0, 100_000_000);
  }

  return normalizeLateFeeRule({ graceDays, dailyRate, fixedDaily, cap });
}

/** 新预付账户预警阈值：0 表示不提醒；上限 100 万元。 */
export function normalizePrepayThreshold(raw: unknown): number {
  return requireInteger(raw, 'prepay.defaultLowBalanceThreshold', 0, 100_000_000);
}

export function normalizeBoolean(raw: unknown, key: string): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;
  throw new SettingValidationError(`${key} 必须是布尔值 (true/false)`);
}

const ALLOWED_BILL_TYPES = new Set(['RENT', 'DEPOSIT', 'UTILITY', 'CLEANING', 'DAMAGE', 'OTHER']);

export function normalizeAutoDeductBillTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new SettingValidationError('prepay.autoDeductBillTypes 必须是数组');
  }
  const types: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !ALLOWED_BILL_TYPES.has(item)) {
      throw new SettingValidationError(`prepay.autoDeductBillTypes 包含不支持的账单类型: ${item}`);
    }
    if (!types.includes(item)) {
      types.push(item);
    }
  }
  return types;
}

export const SETTING_DEFINITIONS = {
  'billing.defaultLateFeeRule': {
    key: 'billing.defaultLateFeeRule',
    description: '新合同默认滞纳金规则（金额单位：分；空规则表示不计收）',
    defaultValue: normalizeDefaultLateFeeRule({}),
    normalize: normalizeDefaultLateFeeRule,
  },
  'prepay.defaultLowBalanceThreshold': {
    key: 'prepay.defaultLowBalanceThreshold',
    description: '新预付账户默认低余额预警阈值（分；0 表示不提醒）',
    defaultValue: 10000,
    normalize: normalizePrepayThreshold,
  },
  'prepay.autoDeductEnabled': {
    key: 'prepay.autoDeductEnabled',
    description: '预付账户自动抵扣未缴账单开关（默认关闭）',
    defaultValue: false,
    normalize: (raw: unknown) => normalizeBoolean(raw, 'prepay.autoDeductEnabled'),
  },
  'prepay.autoDeductBillTypes': {
    key: 'prepay.autoDeductBillTypes',
    description: '预付自动抵扣允许的账单类型列表（默认仅 UTILITY）',
    defaultValue: ['UTILITY'],
    normalize: normalizeAutoDeductBillTypes,
  },
  'prepay.autoDeductPartial': {
    key: 'prepay.autoDeductPartial',
    description: '预付账户余额不足以全额结清时是否允许部分抵扣（默认 false）',
    defaultValue: false,
    normalize: (raw: unknown) => normalizeBoolean(raw, 'prepay.autoDeductPartial'),
  },
} as const satisfies Record<string, SettingDefinition<unknown>>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export function getSettingDefinition(key: SettingKey): SettingDefinition<unknown> {
  return SETTING_DEFINITIONS[key] as SettingDefinition<unknown>;
}
