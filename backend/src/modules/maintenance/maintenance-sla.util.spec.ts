import { describe, expect, it } from 'vitest';
import { calculateMaintenanceSla, evaluateSlaStatus } from './maintenance-sla.util.js';

describe('maintenance-sla.util', () => {
  it('calculates correct SLA due dates based on priority', () => {
    const base = new Date('2026-10-26T10:00:00.000Z');

    const urgent = calculateMaintenanceSla('URGENT', base);
    expect(urgent.responseDueAt.toISOString()).toBe('2026-10-26T12:00:00.000Z'); // +2h
    expect(urgent.slaDueAt.toISOString()).toBe('2026-10-27T10:00:00.000Z'); // +24h

    const normal = calculateMaintenanceSla('NORMAL', base);
    expect(normal.responseDueAt.toISOString()).toBe('2026-10-26T22:00:00.000Z'); // +12h
    expect(normal.slaDueAt.toISOString()).toBe('2026-10-28T10:00:00.000Z'); // +48h

    const low = calculateMaintenanceSla('LOW', base);
    expect(low.responseDueAt.toISOString()).toBe('2026-10-27T10:00:00.000Z'); // +24h
    expect(low.slaDueAt.toISOString()).toBe('2026-10-29T10:00:00.000Z'); // +72h
  });

  it('evaluates SLA status when within deadline', () => {
    const createdAt = new Date('2026-10-26T10:00:00.000Z');
    const { responseDueAt, slaDueAt } = calculateMaintenanceSla('URGENT', createdAt);

    const now = new Date('2026-10-26T11:00:00.000Z');
    const result = evaluateSlaStatus({
      priority: 'URGENT',
      createdAt,
      responseDueAt,
      slaDueAt,
      status: 'SUBMITTED',
      now,
    });
    expect(result.isBreached).toBe(false);
    expect(result.breachType).toBeNull();
  });

  it('evaluates SLA status when response is overdue in SUBMITTED status', () => {
    const createdAt = new Date('2026-10-26T10:00:00.000Z');
    const { responseDueAt, slaDueAt } = calculateMaintenanceSla('URGENT', createdAt);

    const now = new Date('2026-10-26T13:00:00.000Z'); // 3h after creation, deadline was 2h
    const result = evaluateSlaStatus({
      priority: 'URGENT',
      createdAt,
      responseDueAt,
      slaDueAt,
      status: 'SUBMITTED',
      now,
    });
    expect(result.isBreached).toBe(true);
    expect(result.breachType).toBe('RESPONSE_OVERDUE');
  });

  it('evaluates SLA status when resolution is overdue', () => {
    const createdAt = new Date('2026-10-26T10:00:00.000Z');
    const { responseDueAt, slaDueAt } = calculateMaintenanceSla('URGENT', createdAt);

    const now = new Date('2026-10-27T11:00:00.000Z'); // 25h after creation, deadline was 24h
    const result = evaluateSlaStatus({
      priority: 'URGENT',
      createdAt,
      responseDueAt,
      slaDueAt,
      firstRespondedAt: new Date('2026-10-26T11:00:00.000Z'),
      status: 'IN_PROGRESS',
      now,
    });
    expect(result.isBreached).toBe(true);
    expect(result.breachType).toBe('RESOLUTION_OVERDUE');
  });

  it('evaluates completed work order that was resolved past SLA deadline', () => {
    const createdAt = new Date('2026-10-26T10:00:00.000Z');
    const { responseDueAt, slaDueAt } = calculateMaintenanceSla('URGENT', createdAt);

    const resolvedAt = new Date('2026-10-27T12:00:00.000Z'); // Resolved 26h after (past 24h)
    const result = evaluateSlaStatus({
      priority: 'URGENT',
      createdAt,
      responseDueAt,
      slaDueAt,
      firstRespondedAt: new Date('2026-10-26T11:00:00.000Z'),
      status: 'COMPLETED',
      resolvedAt,
    });
    expect(result.isBreached).toBe(true);
    expect(result.breachType).toBe('RESOLUTION_OVERDUE');
  });
});
