import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from './contact.js';

describe('normalizeEmail', () => {
  it('去空白并小写', () => {
    expect(normalizeEmail('  Zhang@Example.com ')).toBe('zhang@example.com');
  });

  it('空值视为未提供', () => {
    expect(normalizeEmail('   ')).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
    expect(normalizeEmail(undefined)).toBeUndefined();
  });
});

describe('normalizePhone', () => {
  it('只去空白', () => {
    expect(normalizePhone(' 13800138000 ')).toBe('13800138000');
    expect(normalizePhone('')).toBeUndefined();
  });
});
