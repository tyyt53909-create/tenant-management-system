---
status: active
owner_tier: strong
applies_to:
  - scripts/perf-baseline.k6.js
  - scripts/slo.mjs
last_verified: 2026-10-25
verified_commit: PENDING
supersedes: null
superseded_by: null
version: 1.0
---

# SLO 与性能基准（OPS-09 / T281）

## 1. 目标

| 指标 | 目标 | 说明 |
|---|---|---|
| 全站请求 P95 | ≤ 300ms | 管理后台核心读接口，正常数据量 |
| 核心端点 P95 | bills/dashboard/meters ≤ 300ms，login ≤ 500ms | 登录含 bcrypt，单独放宽 |
| 请求错误率 | ≤ 0.1% | 5xx + 网络失败 |
| 月度可用性 | ≥ 99.9% | 以 readiness/外部探测为准 |

目标常量在 `scripts/slo.mjs` 的 `SLO_TARGETS`；k6 阈值与文档必须与它保持一致。

## 2. 执行

```bash
# 准备：起服务 + 种子数据（至少 1 栋楼、若干账单）
cd backend && npm run start:prod          # 或 staging
API_BASE=http://127.0.0.1:3100/api \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' \
k6 run --summary-export /tmp/k6-summary.json scripts/perf-baseline.k6.js

# 判定
node -e "import('./scripts/slo.mjs').then(async ({formatSloReport})=>{\
  const s=JSON.parse(require('node:fs').readFileSync('/tmp/k6-summary.json','utf8'));\
  console.log(formatSloReport(s)); process.exit(0);})"
```

> 判定：`node scripts/slo-check.mjs /tmp/k6-summary.json`；退出码 0 达标，1 未达标，2 输入错误。

## 3. 判定口径

- k6 `--summary-export` 的 `metrics.http_req_duration.values['p(95)']`；
- `http_req_failed.values.rate`；
- 端点维度用 k6 tag `endpoint:bills|dashboard|meters`；
- 缺指标视为失败（不能把「没跑」当达标）。

## 4. 与可观测性的关系

- 线上真实延迟看 `app_http_request_duration_seconds`（docs/22），k6 是发布前基线；
- 5xx 比例持续超阈值应由 OPS-09 告警规则接入 `AlertService`；
- 压测数据不得在生产库执行；用 staging 或独立库。

## 5. CI 与频率

- CI 不跑 k6（需要服务、种子与稳定环境），`test:perf` 保留手动执行；
- 每个里程碑（M1/M2/M3）发布候选前跑一次，记录：
  - 数据规模（楼栋/房间/账单数）
  - 并发（默认 100 VUs）
  - P95/错误率
  - 失败端点与瓶颈
- 结果写入 `tasks/evidence/` 或发布记录。

## 6. 已知边界

- 当前脚本以管理后台读接口为主，未覆盖收款、退租等写路径；
- 登录只在 setup 调用一次，未压测 bcrypt 并发；
- 基线依赖机器规格，跨环境比较需注明 CPU/内存/数据库规格。
