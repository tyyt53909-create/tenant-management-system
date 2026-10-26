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

export const DEFAULT_INSPECTION_ITEMS = [
  { name: '入户门及智能门锁', category: 'SECURITY', quantity: 1 },
  { name: '门卡钥匙', category: 'KEYS', quantity: 2 },
  { name: '空调及遥控器', category: 'APPLIANCE', quantity: 1 },
  { name: '热水器', category: 'APPLIANCE', quantity: 1 },
  { name: '洗衣机', category: 'APPLIANCE', quantity: 1 },
  { name: '冰箱', category: 'APPLIANCE', quantity: 1 },
  { name: '床及床垫', category: 'FURNITURE', quantity: 1 },
  { name: '衣柜', category: 'FURNITURE', quantity: 1 },
  { name: '卫浴洁具花洒', category: 'BATHROOM', quantity: 1 },
  { name: '墙面门窗地面', category: 'INTERIOR', quantity: 1 },
];

export function normalizeInspectionItems(raw: unknown): Array<{ name: string; category?: string; quantity: number }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_INSPECTION_ITEMS;
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new SettingValidationError(`leasing.defaultInspectionItems[${idx}] 必须为对象`);
    }
    const name = String((item as any).name || '').trim();
    if (!name) {
      throw new SettingValidationError(`leasing.defaultInspectionItems[${idx}].name 不能为空`);
    }
    const category = (item as any).category ? String((item as any).category).trim() : undefined;
    const quantity = Number.isInteger((item as any).quantity) && (item as any).quantity > 0 ? (item as any).quantity : 1;
    return { name, category, quantity };
  });
}

export function normalizeCheckoutAdvanceDays(raw: unknown): number {
  return requireInteger(raw, 'leasing.minCheckoutAdvanceDays', 0, 365);
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
  'leasing.defaultInspectionItems': {
    key: 'leasing.defaultInspectionItems',
    description: '默认验房设施与物品清单模板',
    defaultValue: DEFAULT_INSPECTION_ITEMS,
    normalize: normalizeInspectionItems,
  },
  'leasing.minCheckoutAdvanceDays': {
    key: 'leasing.minCheckoutAdvanceDays',
    description: '租客发起退租申请的最短提前天数（默认 0 表示不限）',
    defaultValue: 0,
    normalize: normalizeCheckoutAdvanceDays,
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
