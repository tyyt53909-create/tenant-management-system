import { describe, expect, it } from 'vitest';
import { isUniqueConstraintError } from './prisma-error.js';
import { findDuplicateNotifications, findDuplicateRentBills, findDuplicateUnfinishedContracts, rentBillDedupKey } from './duplicate-keys.js';

describe('duplicate key checks', () => {
  it('只列出同一合同同一账期的重复租金账单', () => {
    const groups = findDuplicateRentBills([
      { id: 'b1', contractId: 'c1', billType: 'RENT', period: '2026-10' },
      { id: 'b2', contractId: 'c1', billType: 'RENT', period: '2026-10' },
      { id: 'b3', contractId: 'c1', billType: 'UTILITY', period: '2026-10' },
      { id: 'b4', contractId: 'c1', billType: 'UTILITY', period: '2026-10' },
      { id: 'b5', contractId: 'c1', billType: 'RENT', period: '2026-11' },
    ]);
    expect(groups).toEqual([{ key: rentBillDedupKey('c1', '2026-10'), ids: ['b1', 'b2'] }]);
  });

  it('没有关联对象的通知可以重复，同一账单提醒不行', () => {
    const groups = findDuplicateNotifications([
      { id: 'n1', userId: 'u1', title: '系统公告', data: null },
      { id: 'n2', userId: 'u1', title: '系统公告', data: null },
      { id: 'n3', userId: 'u1', title: '账单逾期提醒', data: { billId: 'bill-1' } },
      { id: 'n4', userId: 'u1', title: '账单逾期提醒', data: { billId: 'bill-1' } },
      { id: 'n5', userId: 'u1', title: '账单逾期提醒', data: { billId: 'bill-2' } },
    ]);
    expect(groups).toEqual([{ key: 'u1:账单逾期提醒:bill-1', ids: ['n3', 'n4'] }]);
  });

  it('识别 Prisma 唯一约束冲突', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2003' })).toBe(false);
    expect(isUniqueConstraintError(new Error('duplicate'))).toBe(false);
  });
});

describe('findDuplicateUnfinishedContracts（T211 部分唯一索引的前置检查）', () => {
  it('同一房源两份未结束合同 → 报冲突', () => {
    const dup = findDuplicateUnfinishedContracts([
      { id: 'c1', roomId: 'r1', status: 'ACTIVE' },
      { id: 'c2', roomId: 'r1', status: 'DRAFT' },
    ]);
    expect(dup).toEqual([{ key: 'r1', ids: ['c1', 'c2'] }]);
  });

  it('不同房源各一份 → 不报', () => {
    expect(
      findDuplicateUnfinishedContracts([
        { id: 'c1', roomId: 'r1', status: 'ACTIVE' },
        { id: 'c2', roomId: 'r2', status: 'DRAFT' },
      ]),
    ).toEqual([]);
  });

  it('已结束的合同（EXPIRED/TERMINATED/RENEWED）不参与判定', () => {
    expect(
      findDuplicateUnfinishedContracts([
        { id: 'c1', roomId: 'r1', status: 'ACTIVE' },
        { id: 'c2', roomId: 'r1', status: 'TERMINATED' },
        { id: 'c3', roomId: 'r1', status: 'EXPIRED' },
        { id: 'c4', roomId: 'r1', status: 'RENEWED' },
      ]),
    ).toEqual([]);
  });
});
