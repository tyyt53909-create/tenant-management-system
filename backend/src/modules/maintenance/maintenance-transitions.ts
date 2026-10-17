import type { MaintenanceStatus } from '@prisma/client';

/**
 * 报修工单状态机（docs/04-状态机.md §4.3 的可执行版本）。
 *
 * COMPLETED / CANCELLED 为终态，不可逆（§4.4）。
 */
export const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  SUBMITTED: ['ACKNOWLEDGED', 'CANCELLED'],
  ACKNOWLEDGED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_CONFIRM', 'CANCELLED'],
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

/** 派单必须知道给谁（§4.3「填写 assignedTo、assignedAt」）。 */
export function maintenanceTransitionNeedsAssignee(to: MaintenanceStatus): boolean {
  return to === 'ASSIGNED';
}

/** 只有确认完成才写 resolvedAt（§4.3 PENDING_CONFIRM → COMPLETED 的副作用）。 */
export function maintenanceTransitionSetsResolvedAt(to: MaintenanceStatus): boolean {
  return to === 'COMPLETED';
}
