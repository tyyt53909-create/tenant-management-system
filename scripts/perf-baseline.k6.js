import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * OPT-26 性能基线压测脚本
 *
 * 验证架构设计 §10.2 性能验收指标：
 * - 100 并发场景下，核心接口响应时间 P95 < 300ms（或稳态 P95 < 300ms）
 * - 请求错误率 < 0.1%
 *
 * 覆盖 4 大核心业务接口：
 * 1. 账单列表: GET /api/bills?page=1&limit=20
 * 2. 统计看板: GET /api/dashboard/stats
 * 3. 批量抄表底册: GET /api/meters/batch-sheet
 * 4. 认证登录: POST /api/auth/login
 *
 * SLO 目标与结果判定见 scripts/slo.mjs / docs/26-SLO与性能基准.md（P95 300ms、错误率 0.1%）。
 *
 * 运行方式：
 *   k6 run --summary-export /tmp/k6-summary.json scripts/perf-baseline.k6.js
 *   API_BASE=http://127.0.0.1:3100/api k6 run scripts/perf-baseline.k6.js
 */

const BASE_URL = __ENV.API_BASE || 'http://127.0.0.1:3100/api';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'Admin@123';

export const options = {
  scenarios: {
    ramping_100_vus: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '3s', target: 50 },
        { duration: '5s', target: 100 },
        { duration: '12s', target: 100 },
        { duration: '3s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // 全局与各业务端点 P95 < 300ms
    http_req_duration: ['p(95)<300'],
    // 错误率 < 0.1%
    http_req_failed: ['rate<0.001'],
    'http_req_duration{endpoint:bills}': ['p(95)<300'],
    'http_req_duration{endpoint:dashboard}': ['p(95)<300'],
    'http_req_duration{endpoint:meters}': ['p(95)<300'],
  },
};

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (loginRes.status !== 200 && loginRes.status !== 201) {
    throw new Error(`Setup 登录失败: status=${loginRes.status}, body=${loginRes.body}`);
  }

  const token = loginRes.json('accessToken');
  return { token };
}

export default function (data) {
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  const r = Math.random();

  if (r < 0.4) {
    // 1. 账单列表（多表关联、分页与滞纳金聚合）
    const res = http.get(`${BASE_URL}/bills?page=1&limit=20`, {
      headers: authHeaders,
      tags: { endpoint: 'bills' },
    });
    check(res, {
      'bills status is 200': (res) => res.status === 200,
      'bills returned array': (res) => Array.isArray(res.json('data')),
    });
  } else if (r < 0.8) {
    // 2. 仪表板统计（房间房态统计与租约计数）
    const res = http.get(`${BASE_URL}/dashboard/stats`, {
      headers: authHeaders,
      tags: { endpoint: 'dashboard' },
    });
    check(res, {
      'dashboard status is 200': (res) => res.status === 200,
      'dashboard has totalRooms': (res) => res.json('totalRooms') !== undefined,
    });
  } else {
    // 3. 批量抄表底册（全房源水电表读取）
    const res = http.get(`${BASE_URL}/meters/batch-sheet`, {
      headers: authHeaders,
      tags: { endpoint: 'meters' },
    });
    check(res, {
      'meters status is 200': (res) => res.status === 200,
      'meters returned list': (res) => Array.isArray(res.json()),
    });
  }

  sleep(0.5);
}
