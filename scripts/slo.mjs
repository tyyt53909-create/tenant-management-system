#!/usr/bin/env node
/**
 * SLO 目标与 k6 结果评估（OPS-09 / T281）。
 *
 * k6 用 `--summary-export` 产出 JSON；本模块把「目标」与「判定」放在一起，
 * 避免文档、脚本、阈值三处漂移。
 */

export const SLO_TARGETS = {
  /** 全站请求 P95（毫秒） */
  globalP95Ms: 300,
  /** 请求失败率 */
  maxErrorRate: 0.001,
  /** 核心端点 P95（毫秒） */
  endpoints: {
    bills: 300,
    dashboard: 300,
    meters: 300,
    login: 500,
  },
  /** 可用性目标（月度） */
  monthlyAvailability: 0.999,
};

function valuesOf(metrics, name) {
  return metrics?.[name]?.values ?? metrics?.[name] ?? {};
}

/** 评估 k6 summary-export JSON；返回 failures 数组（空数组表示达标）。 */
export function evaluateSlo(summary, targets = SLO_TARGETS) {
  const metrics = summary?.metrics ?? summary ?? {};
  const failures = [];
  const duration = valuesOf(metrics, 'http_req_duration');
  const failed = valuesOf(metrics, 'http_req_failed');

  const p95 = Number(duration['p(95)']);
  if (!Number.isFinite(p95)) {
    failures.push('缺少 http_req_duration p(95)');
  } else if (p95 > targets.globalP95Ms) {
    failures.push(`全站 P95 ${p95}ms > ${targets.globalP95Ms}ms`);
  }

  const errorRate = Number(failed.rate);
  if (!Number.isFinite(errorRate)) {
    failures.push('缺少 http_req_failed rate');
  } else if (errorRate > targets.maxErrorRate) {
    failures.push(`错误率 ${errorRate} > ${targets.maxErrorRate}`);
  }

  for (const [endpoint, limit] of Object.entries(targets.endpoints)) {
    const tagged = valuesOf(metrics, `http_req_duration{endpoint:${endpoint}}`);
    const endpointP95 = Number(tagged['p(95)']);
    if (Number.isFinite(endpointP95) && endpointP95 > limit) {
      failures.push(`${endpoint} P95 ${endpointP95}ms > ${limit}ms`);
    }
  }

  return failures;
}

export function formatSloReport(summary, targets = SLO_TARGETS) {
  const failures = evaluateSlo(summary, targets);
  return failures.length === 0
    ? '✅ SLO 达标'
    : `❌ SLO 未达标：\n- ${failures.join('\n- ')}`;
}
