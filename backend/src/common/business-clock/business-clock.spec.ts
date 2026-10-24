import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  addUtcMonths,
  businessMonthKey,
  daysBetween,
  endOfMonthUtc,
  endOfQuarterUtc,
  formatBusinessDate,
  getBusinessParts,
  isValidTimeZone,
  parseDateOnly,
  startOfBusinessDayUtc,
  startOfQuarterUtc,
} from './business-clock.js';
import { BusinessClock } from './business-clock.service.js';

/** 2025-12-31T16:30:00Z = 2026-01-01 00:30（上海） */
const SHANGHAI_NEW_YEAR = new Date('2025-12-31T16:30:00.000Z');

describe('BusinessClock 纯函数', () => {
  it('上海凌晨 00:30 的业务日是当天，而不是 UTC 前一天', () => {
    expect(formatBusinessDate(SHANGHAI_NEW_YEAR, 'Asia/Shanghai')).toBe('2026-01-01');
    expect(formatBusinessDate(SHANGHAI_NEW_YEAR, 'UTC')).toBe('2025-12-31');
    expect(startOfBusinessDayUtc(SHANGHAI_NEW_YEAR, 'Asia/Shanghai').toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('业务日/月键按业务时区计算', () => {
    expect(getBusinessParts(SHANGHAI_NEW_YEAR, 'Asia/Shanghai')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
    expect(businessMonthKey(SHANGHAI_NEW_YEAR, 'Asia/Shanghai')).toBe('2026-01');
  });

  it('季度边界：3 月 31 日 23:30 仍属 Q1，4 月 1 日 00:30 属 Q2', () => {
    const q1End = new Date('2026-03-31T15:30:00.000Z'); // 上海 23:30
    const q2Start = new Date('2026-03-31T16:30:00.000Z'); // 上海 4/1 00:30

    expect(startOfQuarterUtc(startOfBusinessDayUtc(q1End, 'Asia/Shanghai')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(endOfQuarterUtc(startOfBusinessDayUtc(q1End, 'Asia/Shanghai')).toISOString()).toBe(
      '2026-03-31T23:59:59.999Z',
    );
    expect(startOfQuarterUtc(startOfBusinessDayUtc(q2Start, 'Asia/Shanghai')).toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('月末与月份加减按 UTC 日历日', () => {
    const feb = new Date('2026-02-10T00:00:00.000Z');
    expect(endOfMonthUtc(feb).toISOString()).toBe('2026-02-28T23:59:59.999Z');
    expect(addUtcMonths(feb, 1).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('自然日差值', () => {
    expect(
      daysBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-08T00:00:00.000Z')),
    ).toBe(7);
  });

  it('parseDateOnly 严格解析并拒绝非法日期', () => {
    expect(parseDateOnly('2026-02-28')?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(parseDateOnly(' 2026-03-01 ')?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026/02/28')).toBeNull();
    expect(parseDateOnly('2026-2-8')).toBeNull();
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('BusinessClock service', () => {
  it('默认 Asia/Shanghai，并委托纯函数', () => {
    const clock = new BusinessClock(new ConfigService({}));
    expect(clock.timeZone).toBe('Asia/Shanghai');
    expect(clock.formatDate(SHANGHAI_NEW_YEAR)).toBe('2026-01-01');
    expect(clock.todayUtc(SHANGHAI_NEW_YEAR).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('读取 BUSINESS_TIMEZONE', () => {
    const clock = new BusinessClock(new ConfigService({ BUSINESS_TIMEZONE: 'UTC' }));
    expect(clock.timeZone).toBe('UTC');
    expect(clock.formatDate(SHANGHAI_NEW_YEAR)).toBe('2025-12-31');
  });

  it('非法时区启动即失败', () => {
    expect(() => new BusinessClock(new ConfigService({ BUSINESS_TIMEZONE: 'Mars/Olympus' }))).toThrow(
      /BUSINESS_TIMEZONE/,
    );
  });
});
