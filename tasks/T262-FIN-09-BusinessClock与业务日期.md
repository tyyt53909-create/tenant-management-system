---
status: active
execution_status: active
task_id: T262
plan_ref: FIN-09
stage: M1
priority: P0
model_tier: 强
branch: feature/T262-fin-09
start_time: 2026-10-24
complete_time:
merge_commit:
blocked_by:
depends_on:
acceptance_evidence: tasks/evidence/T262.md
handoff: docs/handoff/2026-10-24-T262-BusinessClock与业务日期.md
---

# T262：BusinessClock 与业务日期（FIN-09）

## 背景

ISS-11：后端有 16 处直接用运行环境本地时区计算「今天 / 本月 / 本季度」，部署在 UTC 容器与本地 `Asia/Shanghai` 会得到不同的业务日：

- 凌晨 00:00–08:00（上海）在 UTC 仍是前一天 → 账单日、收据编号、逾期天数、月度统计错位。
- `new Date(y, m, d)` 依赖进程 TZ；容器默认 UTC。
- 导入与导出对 `yyyy-MM-dd` 的解析/格式化不统一。

DEC-01 已拍板目标市场为 `Asia/Shanghai`。本任务把业务日期收敛到唯一的 `BusinessClock`，禁止业务代码自行做本地时区运算。

## 范围

### 1. BusinessClock

新增 `backend/src/common/business-clock/`：

- `business-clock.ts`：纯函数核心（可单测）：
  - `getBusinessParts(date, timeZone)`、`startOfBusinessDayUtc(date, tz)`、`formatBusinessDate(date, tz)`、`businessMonthKey(date, tz)`。
  - `addUtcDays`、`addUtcMonths`、`startOfMonthUtc`、`endOfMonthUtc`、`startOfQuarterUtc`、`endOfQuarterUtc`、`startOfYearUtc`、`endOfYearUtc`、`daysBetween`、`parseDateOnly`。
- `business-clock.service.ts`：`@Injectable()` 包装，读取 `BUSINESS_TIMEZONE`（默认 `Asia/Shanghai`），提供 `now()` 与上述方法。
- `business-clock.module.ts`：`@Global()` 导出 service，AppModule 引入。

### 2. 替换本地时区运算

- `scheduler/scheduler.util.ts`：保留既有导出，内部改为调用 BusinessClock 纯函数（避免破坏调度器）。
- `scheduler/scheduler-daily-jobs.service.ts`：业务日零点/当天去重改用 clock。
- `statistics/statistics.service.ts`：今日/本月/本季/本年范围。
- `dashboard/dashboard.service.ts` 与 `management-summary.service.ts`：月份桶与今日统计。
- `meters/meter-usage-query.service.ts` 与 `meter-billing.service.ts`：月份键、到期日加减。
- `bills/bills.controller.ts`、`prepay/prepay.controller.ts`、`checkout/checkout.controller.ts`：收据/流水号日期前缀。
- `bills`、`checkout` 导出中的 `toISOString().slice(0,10)` 改用 `formatBusinessDate`。
- `imports/imports.service.ts`：`yyyy-MM-dd` 解析改用 `parseDateOnly`（UTC 零点，不随进程 TZ 变化）。

### 3. 配置

- `env.schema.ts` 新增可选 `BUSINESS_TIMEZONE`（默认 `Asia/Shanghai`），非法 IANA 时区启动失败（生产/预发）。
- `backend/.env.example`、`.env.prod.example`、`docs/12` 同步。

### 4. 测试

- TZ 矩阵：同一时刻在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下运行，业务日/月键/季度边界一致。
  - `2026-01-01T00:30:00+08:00` 的业务日必须是 `2026-01-01`（UTC 仍是 2025-12-31）。
  - `2026-03-31T23:30:00+08:00` 仍属 Q1；`2026-04-01T00:30:00+08:00` 属 Q2。
- `parseDateOnly('2026-02-28')` 在任何 TZ 下都是 UTC 零点。
- 更新受影响的 statistics/dashboard/meters/bills 单测断言。

## 非目标

- 修改数据库 `@db.Date` 存储口径（继续使用 UTC 零点表示业务日）。
- 时区可配置为用户级（当前单组织，固定业务时区）。
- 账单/合同业务规则本身（FIN-01/02/05）。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | `TZ=UTC` 与 `TZ=Asia/Shanghai` 下业务日/月/季一致 | `business-clock.spec.ts`（子进程或纯函数固定时刻） |
| 2 | 上海凌晨 00:30 的「今天」是当天而不是 UTC 前一天 | 边界用例 |
| 3 | 账单/收据/导出不再使用进程本地时区 | `grep` 业务模块无 `getMonth()/getFullYear()/setDate` 直接运算 |
| 4 | 导入 `yyyy-MM-dd` 在任意 TZ 下解析为同一 UTC 日期 | `imports` 单测 |
| 5 | 全量测试、lint、tsc、e2e、docs-check 通过 | `tasks/evidence/T262.md` |

## 文件归属

- `backend/src/common/business-clock/business-clock.ts`、`business-clock.service.ts`、`business-clock.module.ts`、`business-clock.spec.ts`（新增）
- `backend/src/app.module.ts`
- `backend/src/config/env.schema.ts`、`env.validation.spec.ts`
- `backend/src/modules/scheduler/scheduler.util.ts`、`scheduler-daily-jobs.service.ts`
- `backend/src/modules/statistics/statistics.service.ts`
- `backend/src/modules/dashboard/dashboard.service.ts`、`management-summary.service.ts`
- `backend/src/modules/meters/meter-usage-query.service.ts`、`meter-billing.service.ts`
- `backend/src/modules/bills/bills.controller.ts`、`bills.service.ts`
- `backend/src/modules/prepay/prepay.controller.ts`
- `backend/src/modules/checkout/checkout.controller.ts`、`checkout.service.ts`
- `backend/src/modules/imports/imports.service.ts`
- `backend/.env.example`、`.env.prod.example`
- `docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T262-fin-09`
- 基线：`2ac3ef6`（含 T261 回填）
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-24
- 状态：in_progress

## 风险

- 业务日口径变化会影响账单日、逾期天数与统计；上线前需用 `TZ=UTC` 与 `TZ=Asia/Shanghai` 跑同一套 e2e。
- `BUSINESS_TIMEZONE` 允许改配置，但迁移已有的 `@db.Date` 数据不在本任务范围；默认值必须保持 `Asia/Shanghai`。
- 纯函数与 service 双入口，需避免两套实现漂移；service 只做配置注入与委托。
