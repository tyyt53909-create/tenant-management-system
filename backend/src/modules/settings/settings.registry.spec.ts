import { describe, expect, it } from 'vitest';
import {
  SettingValidationError,
  getSettingDefinition,
  isSettingKey,
  normalizeDefaultLateFeeRule,
  normalizePrepayThreshold,
} from './settings.registry.js';

describe('设置注册表（T276 / T296）', () => {
  it('登记预付与账单业务设置 key，未知 key 不通过', () => {
    expect(isSettingKey('billing.defaultLateFeeRule')).toBe(true);
    expect(isSettingKey('prepay.defaultLowBalanceThreshold')).toBe(true);
    expect(isSettingKey('prepay.autoDeductEnabled')).toBe(true);
    expect(isSettingKey('prepay.autoDeductBillTypes')).toBe(true);
    expect(isSettingKey('prepay.autoDeductPartial')).toBe(true);
    expect(isSettingKey('billing.unknown')).toBe(false);
    expect(getSettingDefinition('prepay.defaultLowBalanceThreshold').defaultValue).toBe(10000);
    expect(getSettingDefinition('prepay.autoDeductEnabled').defaultValue).toBe(false);
    expect(getSettingDefinition('prepay.autoDeductBillTypes').defaultValue).toEqual(['UTILITY']);
    expect(getSettingDefinition('prepay.autoDeductPartial').defaultValue).toBe(false);
  });

  it('滞纳金规则：空值、部分字段、完整字段都能归一化', () => {
    expect(normalizeDefaultLateFeeRule(undefined)).toEqual({
      graceDays: 0,
      dailyRate: null,
      fixedDaily: null,
      cap: null,
    });
    expect(normalizeDefaultLateFeeRule({ graceDays: 3, dailyRate: 0.003, cap: 50000 })).toEqual({
      graceDays: 3,
      dailyRate: 0.003,
      fixedDaily: null,
      cap: 50000,
    });
  });

  it('滞纳金规则拒绝未知字段与越界值', () => {
    expect(() => normalizeDefaultLateFeeRule({ typo: 1 })).toThrow(SettingValidationError);
    expect(() => normalizeDefaultLateFeeRule({ graceDays: -1 })).toThrow(SettingValidationError);
    expect(() => normalizeDefaultLateFeeRule({ graceDays: 366 })).toThrow(SettingValidationError);
    expect(() => normalizeDefaultLateFeeRule({ dailyRate: 2 })).toThrow(SettingValidationError);
    expect(() => normalizeDefaultLateFeeRule({ fixedDaily: 1.5 })).toThrow(SettingValidationError);
    expect(() => normalizeDefaultLateFeeRule([] as never)).toThrow(SettingValidationError);
  });

  it('预付阈值必须是 0–1,000,000 元的整数分，0 合法', () => {
    expect(normalizePrepayThreshold(0)).toBe(0);
    expect(normalizePrepayThreshold(10000)).toBe(10000);
    expect(() => normalizePrepayThreshold(-1)).toThrow(SettingValidationError);
    expect(() => normalizePrepayThreshold(1.5)).toThrow(SettingValidationError);
    expect(() => normalizePrepayThreshold(100_000_001)).toThrow(SettingValidationError);
  });

  it('预付自动抵扣布尔开关与账单类型归一化', () => {
    const enabledDef = getSettingDefinition('prepay.autoDeductEnabled');
    expect(enabledDef.normalize(true)).toBe(true);
    expect(enabledDef.normalize('true')).toBe(true);
    expect(enabledDef.normalize(false)).toBe(false);
    expect(enabledDef.normalize('0')).toBe(false);
    expect(() => enabledDef.normalize('invalid')).toThrow(SettingValidationError);

    const billTypesDef = getSettingDefinition('prepay.autoDeductBillTypes');
    expect(billTypesDef.normalize(['UTILITY'])).toEqual(['UTILITY']);
    expect(billTypesDef.normalize(['RENT', 'UTILITY', 'RENT'])).toEqual(['RENT', 'UTILITY']);
    expect(() => billTypesDef.normalize('not-array')).toThrow(SettingValidationError);
    expect(() => billTypesDef.normalize(['INVALID_TYPE'])).toThrow(SettingValidationError);
  });
});
