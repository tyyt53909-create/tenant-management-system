import type { MaintenancePriority, MaintenanceStatus } from '@prisma/client';

export interface SlaCalculationResult {
  responseDueAt: Date;
  slaDueAt: Date;
}

export interface SlaEvaluationResult {
  isBreached: boolean;
  breachType: 'RESPONSE_OVERDUE' | 'RESOLUTION_OVERDUE' | null;
  breachAt: Date | null;
}

/**
 * 报修工单 SLA 时限计算规则（WRK-02 / T303）：
 * - URGENT 紧急：2h 响应 / 24h 解决
 * - NORMAL 普通：12h 响应 / 48h 解决
 * - LOW 低优先：24h 响应 / 72h 解决
 */
export function calculateMaintenanceSla(
  priority: MaintenancePriority | string,
  createdAt: Date = new Date(),
): SlaCalculationResult {
  const baseTime = createdAt.getTime();
  let responseHours = 12;
  let slaHours = 48;

  switch (priority) {
    case 'URGENT':
      responseHours = 2;
      slaHours = 24;
      break;
    case 'LOW':
      responseHours = 24;
      slaHours = 72;
      break;
    case 'NORMAL':
    default:
      responseHours = 12;
      slaHours = 48;
      break;
  }

  return {
    responseDueAt: new Date(baseTime + responseHours * 3600 * 1000),
    slaDueAt: new Date(baseTime + slaHours * 3600 * 1000),
  };
}

/**
 * 实时评估工单 SLA 状态
 */
export function evaluateSlaStatus(params: {
  priority: MaintenancePriority | string;
  createdAt: Date;
  responseDueAt?: Date | null;
  slaDueAt?: Date | null;
  firstRespondedAt?: Date | null;
  status: MaintenanceStatus | string;
  resolvedAt?: Date | null;
  now?: Date;
}): SlaEvaluationResult {
  const now = params.now ?? new Date();
  const { responseDueAt, slaDueAt } =
    params.responseDueAt && params.slaDueAt
      ? { responseDueAt: params.responseDueAt, slaDueAt: params.slaDueAt }
      : calculateMaintenanceSla(params.priority, params.createdAt);

  // 1. 终态已取消，不作逾期判断（除非在取消前已被判定超时）
  if (params.status === 'CANCELLED') {
    return { isBreached: false, breachType: null, breachAt: null };
  }

  // 2. 已完成工单评估
  if (params.status === 'COMPLETED') {
    if (params.resolvedAt && params.resolvedAt.getTime() > slaDueAt.getTime()) {
      return { isBreached: true, breachType: 'RESOLUTION_OVERDUE', breachAt: slaDueAt };
    }
    if (params.firstRespondedAt && params.firstRespondedAt.getTime() > responseDueAt.getTime()) {
      return { isBreached: true, breachType: 'RESPONSE_OVERDUE', breachAt: responseDueAt };
    }
    return { isBreached: false, breachType: null, breachAt: null };
  }

  // 3. 仍在处理中或提交阶段的工单
  // 3.1 解决超时判断
  if (now.getTime() > slaDueAt.getTime()) {
    return { isBreached: true, breachType: 'RESOLUTION_OVERDUE', breachAt: slaDueAt };
  }

  // 3.2 响应超时判断：若工单仍处于 SUBMITTED 状态且已过响应死线，或首次响应时间超期
  if (!params.firstRespondedAt && params.status === 'SUBMITTED' && now.getTime() > responseDueAt.getTime()) {
    return { isBreached: true, breachType: 'RESPONSE_OVERDUE', breachAt: responseDueAt };
  }

  if (params.firstRespondedAt && params.firstRespondedAt.getTime() > responseDueAt.getTime()) {
    return { isBreached: true, breachType: 'RESPONSE_OVERDUE', breachAt: responseDueAt };
  }

  return { isBreached: false, breachType: null, breachAt: null };
}
