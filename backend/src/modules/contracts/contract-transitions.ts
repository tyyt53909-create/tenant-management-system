import type { CleanStatus, ContractStatus, RoomStatus } from '@prisma/client';

/**
 * 合同状态机（docs/04-状态机.md §2.3 的可执行版本）。
 *
 * 同一处定义合法流转与房间副作用，API（contracts.service.update）与定时任务
 * （scheduler-daily-jobs.autoTransitionContracts）都从这里取，避免两处各写一份而漂移。
 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['EXPIRED', 'TERMINATED', 'RENEWED'],
  EXPIRED: ['RENEWED'],
  // 终态：不可逆（docs/04 §2.4）
  TERMINATED: [],
  RENEWED: [],
};

export function isContractTransitionAllowed(from: ContractStatus, to: ContractStatus): boolean {
  return (CONTRACT_TRANSITIONS[from] ?? []).includes(to);
}

export interface RoomEffect {
  status?: RoomStatus;
  cleanStatus?: CleanStatus;
  /** 房态状态机的前置条件（docs/04 §1.3）：只有当前房态匹配时才随动，否则跳过。 */
  requiresRoomStatus: RoomStatus;
}

const ROOM_EFFECTS: Record<string, RoomEffect> = {
  // DRAFT → ACTIVE：合同生效日到达/管理者手动生效 → 预留房转为已入住
  'DRAFT->ACTIVE': { status: 'OCCUPIED', requiresRoomStatus: 'RESERVED' },
  // ACTIVE → TERMINATED：提前退租 → 房间退出占用并进入待清洁
  'ACTIVE->TERMINATED': { status: 'VACANT', cleanStatus: 'PENDING_CLEAN', requiresRoomStatus: 'OCCUPIED' },
};

/** 该流转对房间的副作用；没有副作用返回 null。 */
export function roomEffectForContractTransition(from: ContractStatus, to: ContractStatus): RoomEffect | null {
  return ROOM_EFFECTS[`${from}->${to}`] ?? null;
}

/**
 * 计算房间随动的 update data（含 version 自增），供 API 与定时任务共用。
 *
 * 房态状态机的前置条件不满足（例如房间当前不是 RESERVED/OCCUPIED）时返回 null ——
 * 保持与既有定时任务相同的「前置不满足就跳过」语义，不因合同流转而强改房态。
 */
export function roomUpdateForContractTransition(
  room: { status: RoomStatus },
  from: ContractStatus,
  to: ContractStatus,
): { status?: RoomStatus; cleanStatus?: CleanStatus; version: { increment: number } } | null {
  const effect = roomEffectForContractTransition(from, to);
  if (!effect || room.status !== effect.requiresRoomStatus) return null;
  return {
    ...(effect.status ? { status: effect.status } : {}),
    ...(effect.cleanStatus ? { cleanStatus: effect.cleanStatus } : {}),
    version: { increment: 1 },
  };
}
