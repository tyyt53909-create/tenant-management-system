import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ROOM_TRANSITIONS,
  assertPreconditionMet,
  assertTransitionTable,
  isTransitionAllowed,
  PRECONDITION_MESSAGES,
  requiredPreconditions,
  transitionKey,
} from './room-transitions.js';

describe('房态流转表（T288 抽取自 rooms.service）', () => {
  it('文档中的合法流转全部允许', () => {
    const legal: Array<[string, string]> = [
      ['VACANT+CLEAN', 'RESERVED+CLEAN'],
      ['VACANT+CLEAN', 'MAINTENANCE+CLEAN'],
      ['RESERVED+CLEAN', 'OCCUPIED+CLEAN'],
      ['OCCUPIED+CLEAN', 'VACANT+PENDING_CLEAN'],
      ['OCCUPIED+CLEAN', 'MAINTENANCE+CLEAN'],
      ['MAINTENANCE+CLEAN', 'OCCUPIED+CLEAN'],
      ['MAINTENANCE+CLEAN', 'VACANT+PENDING_CLEAN'],
      ['VACANT+PENDING_CLEAN', 'VACANT+CLEANING'],
      ['VACANT+CLEANING', 'VACANT+CLEAN'],
    ];
    for (const [from, to] of legal) {
      expect(isTransitionAllowed(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('跳级与回退一律拒绝', () => {
    const illegal: Array<[string, string]> = [
      ['VACANT+CLEAN', 'OCCUPIED+CLEAN'],
      ['RESERVED+CLEAN', 'VACANT+CLEAN'],
      ['OCCUPIED+CLEAN', 'RESERVED+CLEAN'],
      ['VACANT+CLEANING', 'OCCUPIED+CLEAN'],
    ];
    for (const [from, to] of illegal) {
      expect(isTransitionAllowed(from, to), `${from} → ${to}`).toBe(false);
    }
  });

  it('相同状态视为幂等允许', () => {
    expect(isTransitionAllowed('OCCUPIED+CLEAN', 'OCCUPIED+CLEAN')).toBe(true);
  });

  it('未知来源状态没有任何出边', () => {
    expect(ALLOWED_ROOM_TRANSITIONS['UNKNOWN+CLEAN']).toBeUndefined();
    expect(isTransitionAllowed('UNKNOWN+CLEAN', 'VACANT+CLEAN')).toBe(false);
  });

  it('非法流转抛 ROOM_NOT_AVAILABLE 且消息含起止状态', () => {
    expect(() => assertTransitionTable('VACANT+CLEAN', 'OCCUPIED+CLEAN')).toThrow(/不允许的房态流转/);
    expect(() => assertTransitionTable('VACANT+CLEAN', 'OCCUPIED+CLEAN')).toThrow(/VACANT\+CLEAN → OCCUPIED\+CLEAN/);
    expect(() => assertTransitionTable('VACANT+CLEAN', 'RESERVED+CLEAN')).not.toThrow();
  });

  it('前置条件按目标状态给出，且与文档一一对应', () => {
    expect(requiredPreconditions('VACANT+CLEAN', 'RESERVED+CLEAN')).toEqual([{ kind: 'DRAFT_CONTRACT' }]);
    expect(requiredPreconditions('RESERVED+CLEAN', 'OCCUPIED+CLEAN')).toEqual([{ kind: 'CONTRACT_STARTED' }]);
    expect(requiredPreconditions('OCCUPIED+CLEAN', 'VACANT+PENDING_CLEAN')).toEqual([
      { kind: 'CHECKOUT_RECORD' },
    ]);
    expect(requiredPreconditions('VACANT+CLEAN', 'MAINTENANCE+CLEAN')).toEqual([
      { kind: 'MAINTENANCE_REQUEST' },
    ]);
    expect(requiredPreconditions('VACANT+CLEANING', 'VACANT+CLEAN')).toEqual([]);
    // 同状态不查任何前置
    expect(requiredPreconditions('RESERVED+CLEAN', 'RESERVED+CLEAN')).toEqual([]);
  });

  it('位置参数型调用返回新的数组，避免调用方改坏常量', () => {
    const first = requiredPreconditions('VACANT+CLEAN', 'RESERVED+CLEAN');
    first.push({ kind: 'CHECKOUT_RECORD' });
    expect(requiredPreconditions('VACANT+CLEAN', 'RESERVED+CLEAN')).toEqual([{ kind: 'DRAFT_CONTRACT' }]);
  });

  it('前置条件缺失抛 400，文案可被前端直接展示', () => {
    for (const [kind, message] of Object.entries(PRECONDITION_MESSAGES)) {
      expect(() => assertPreconditionMet({ kind } as never, false)).toThrow(BadRequestException);
      expect(() => assertPreconditionMet({ kind } as never, false)).toThrow(message);
      expect(() => assertPreconditionMet({ kind } as never, true)).not.toThrow();
    }
  });

  it('transitionKey 拼接口径稳定', () => {
    expect(transitionKey('VACANT', 'CLEAN')).toBe('VACANT+CLEAN');
  });
});
