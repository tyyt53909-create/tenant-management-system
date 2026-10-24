import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateSlo, formatSloReport, SLO_TARGETS } from './slo.mjs';

function summary({ p95 = 200, rate = 0, endpoints = {} } = {}) {
  const metrics = {
    http_req_duration: { values: { 'p(95)': p95 } },
    http_req_failed: { values: { rate } },
  };
  for (const [name, value] of Object.entries(endpoints)) {
    metrics[`http_req_duration{endpoint:${name}}`] = { values: { 'p(95)': value } };
  }
  return { metrics };
}

test('达标时无失败项', () => {
  assert.deepEqual(evaluateSlo(summary()), []);
  assert.match(formatSloReport(summary()), /达标/);
});

test('全站/端点 P95 与错误率超限会被指出', () => {
  const failures = evaluateSlo(
    summary({
      p95: 350,
      rate: 0.01,
      endpoints: { bills: 400, login: 600 },
    }),
  );
  assert.equal(failures.length, 4);
  assert.ok(failures.some((item) => item.includes('全站 P95')));
  assert.ok(failures.some((item) => item.includes('错误率')));
  assert.ok(failures.some((item) => item.includes('bills')));
  assert.ok(failures.some((item) => item.includes('login')));
});

test('缺少指标时明确失败，而不是当作达标', () => {
  const failures = evaluateSlo({ metrics: {} });
  assert.equal(failures.length, 2);
  assert.ok(failures.every((item) => item.includes('缺少')));
});

test('目标常量与 k6 脚本保持一致（文档即代码）', () => {
  assert.equal(SLO_TARGETS.globalP95Ms, 300);
  assert.equal(SLO_TARGETS.maxErrorRate, 0.001);
  assert.equal(SLO_TARGETS.monthlyAvailability, 0.999);
});
