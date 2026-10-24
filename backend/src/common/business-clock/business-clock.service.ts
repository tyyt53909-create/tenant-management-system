import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  addUtcDays,
  addUtcMonths,
  businessMonthKey,
  daysBetween,
  endOfMonthUtc,
  endOfQuarterUtc,
  endOfYearUtc,
  formatBusinessDate,
  getBusinessParts,
  isValidTimeZone,
  parseDateOnly,
  startOfBusinessDayUtc,
  startOfMonthUtc,
  startOfQuarterUtc,
  startOfYearUtc,
  type BusinessParts,
} from './business-clock.js';

/**
 * 业务时钟：所有「今天 / 本月 / 本季」必须经此服务，禁止直接用进程本地时区。
 */
@Injectable()
export class BusinessClock {
  readonly timeZone: string;

  constructor(configService: ConfigService) {
    const configured = configService.get<string>('BUSINESS_TIMEZONE')?.trim();
    if (configured && !isValidTimeZone(configured)) {
      throw new Error(`BUSINESS_TIMEZONE 不是合法的 IANA 时区: ${configured}`);
    }
    this.timeZone = configured || DEFAULT_BUSINESS_TIMEZONE;
  }

  now(): Date {
    return new Date();
  }

  parts(date: Date = this.now()): BusinessParts {
    return getBusinessParts(date, this.timeZone);
  }

  /** 业务日的 UTC 零点（@db.Date 口径）。 */
  todayUtc(date: Date = this.now()): Date {
    return startOfBusinessDayUtc(date, this.timeZone);
  }

  formatDate(date: Date = this.now()): string {
    return formatBusinessDate(date, this.timeZone);
  }

  monthKey(date: Date = this.now()): string {
    return businessMonthKey(date, this.timeZone);
  }

  addDays(date: Date, days: number): Date {
    return addUtcDays(date, days);
  }

  addMonths(date: Date, months: number): Date {
    return addUtcMonths(date, months);
  }

  startOfMonth(date: Date): Date {
    return startOfMonthUtc(date);
  }

  endOfMonth(date: Date): Date {
    return endOfMonthUtc(date);
  }

  startOfQuarter(date: Date): Date {
    return startOfQuarterUtc(date);
  }

  endOfQuarter(date: Date): Date {
    return endOfQuarterUtc(date);
  }

  startOfYear(date: Date): Date {
    return startOfYearUtc(date);
  }

  endOfYear(date: Date): Date {
    return endOfYearUtc(date);
  }

  daysBetween(from: Date, to: Date): number {
    return daysBetween(from, to);
  }

  parseDateOnly(value: string): Date | null {
    return parseDateOnly(value);
  }
}
