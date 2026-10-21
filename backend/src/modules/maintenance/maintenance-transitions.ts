import type { MaintenanceStatus } from '@prisma/client';

/**
 * 报修工单状态机（docs/04-状态机.md §4.3 的可执行版本）。
 *
 * COMPLETED / CANCELLED 为终态，不可逆（§4.4）。
 *
 * T225 起 ASSIGNED 表示「待接单」：管理者可指派具体维修人员，也可不指派
 * （assignedTo = null，进入公共池，由维修人员先接先得）。因此不再强制
 * ASSIGNED 必须带 assignedTo。
 */
export const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  SUBMITTED: ['ACKNOWLEDGED', 'CANCELLED'],
  ACKNOWLEDGED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_CONFIRM', 'ASSIGNED', 'CANCELLED'],
  PENDING_CONFIRM: ['COMPLETED', 'IN_PROGRESS'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isMaintenanceTransitionAllowed(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
): boolean {
  return (MAINTENANCE_TRANSITIONS[from] ?? []).includes(to);
}

/** 只有确认完成才写 resolvedAt（§4.3 PENDING_CONFIRM → COMPLETED 的副作用）。 */
export function maintenanceTransitionSetsResolvedAt(to: MaintenanceStatus): boolean {
  return to === 'COMPLETED';
}
