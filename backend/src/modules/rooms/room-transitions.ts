import { BadRequestException } from '@nestjs/common';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';

/**
 * 房态流转规则（QLT-02 / T288：从 `rooms.service.ts` 抽出）。
 *
 * 规则本身来自 docs/04-状态机.md §1.3–1.4，此前以 `status+cleanStatus` 字符串拼接散落在
 * service 私有方法里，既难单测也容易与文档漂移。这里拆成两层：
 * - 纯函数 `isTransitionAllowed`：只判断「这件事能不能做」；
 * - `assertTransitionAllowed`：需要查库的前置条件（草稿合同/合同起始日/退租记录/报修工单）。
 */

/** 允许的房态流转（键与值均为 `status+cleanStatus`，docs/04 §1.3） */
export const ALLOWED_ROOM_TRANSITIONS: Record<string, readonly string[]> = {
  'VACANT+CLEAN': ['RESERVED+CLEAN', 'MAINTENANCE+CLEAN'],
  'RESERVED+CLEAN': ['OCCUPIED+CLEAN'],
  'OCCUPIED+CLEAN': ['VACANT+PENDING_CLEAN', 'MAINTENANCE+CLEAN'],
  'MAINTENANCE+CLEAN': ['OCCUPIED+CLEAN', 'VACANT+PENDING_CLEAN'],
  'VACANT+PENDING_CLEAN': ['VACANT+CLEANING'],
  'VACANT+CLEANING': ['VACANT+CLEAN'],
};

export function transitionKey(status: string, cleanStatus: string): string {
  return `${status}+${cleanStatus}`;
}

/** 流转表判断；同一状态视为允许（幂等）。 */
export function isTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  return (ALLOWED_ROOM_TRANSITIONS[from] ?? []).includes(to);
}

/** 流转前需要查库确认的前置条件（返回 null 表示无条件）。 */
export type TransitionPrecondition =
  | { kind: 'DRAFT_CONTRACT' }
  | { kind: 'CONTRACT_STARTED' }
  | { kind: 'CHECKOUT_RECORD' }
  | { kind: 'MAINTENANCE_REQUEST' };

/**
 * 目标流转需要哪些前置数据。
 * 与 docs/04 §1.4 一一对应：
 * - 转 RESERVED 必须有草稿合同；
 * - RESERVED → OCCUPIED 需要合同已到起始日；
 * - 转待清洁需要退租记录；
 * - 转维修需要有报修工单。
 */
export function requiredPreconditions(from: string, to: string): TransitionPrecondition[] {
  if (from === to) return [];
  const requirements: TransitionPrecondition[] = [];
  if (to === 'RESERVED+CLEAN') requirements.push({ kind: 'DRAFT_CONTRACT' });
  if (from === 'RESERVED+CLEAN' && to === 'OCCUPIED+CLEAN') {
    requirements.push({ kind: 'CONTRACT_STARTED' });
  }
  if (to === 'VACANT+PENDING_CLEAN') requirements.push({ kind: 'CHECKOUT_RECORD' });
  if (to === 'MAINTENANCE+CLEAN') requirements.push({ kind: 'MAINTENANCE_REQUEST' });
  return requirements;
}

export const PRECONDITION_MESSAGES: Record<TransitionPrecondition['kind'], string> = {
  DRAFT_CONTRACT: '流转前置条件不满足：该房间没有草稿合同',
  CONTRACT_STARTED: '流转前置条件不满足：合同起始日期未到',
  CHECKOUT_RECORD: '流转前置条件不满足：该房间没有退租记录',
  MAINTENANCE_REQUEST: '流转前置条件不满足：该房间没有报修工单',
};

/** 校验流转表；非法流转抛 400（ROOM_NOT_AVAILABLE）。 */
export function assertTransitionTable(from: string, to: string): void {
  if (!isTransitionAllowed(from, to)) {
    throw apiError(ErrorCode.ROOM_NOT_AVAILABLE, `不允许的房态流转：${from} → ${to}`);
  }
}

/** 前置条件缺失时抛 400。 */
export function assertPreconditionMet(precondition: TransitionPrecondition, present: boolean): void {
  if (!present) {
    throw new BadRequestException(PRECONDITION_MESSAGES[precondition.kind]);
  }
}
