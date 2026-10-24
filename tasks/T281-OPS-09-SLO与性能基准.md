---
status: completed
execution_status: completed
task_id: T281
plan_ref: OPS-09
stage: M2
priority: P1
model_tier: 普通
branch: feature/T281-ops-09-slo
start_time: 2026-10-25
complete_time: 2026-10-25
merge_commit: f2887fb
blocked_by:
depends_on: T255, T277
acceptance_evidence: tasks/evidence/T281.md
handoff: docs/handoff/2026-10-25-T281-SLO与性能基准.md
---

# T281：性能基准与 SLO（OPS-09）

## 范围

- `scripts/slo.mjs`：SLO 目标常量 + k6 summary 判定纯函数。
- `scripts/slo-check.mjs`：CLI 读取 `--summary-export` JSON，输出达标/失败并以退出码表达。
- `scripts/slo.test.mjs`：达标/超限/缺指标三类用例。
- k6 脚本补 SLO 引用与 `--summary-export` 用法。
- `docs/26-SLO与性能基准.md`：目标、执行、判定口径、频率与边界。

## 非目标

- CI 内跑 k6（需要稳定环境与种子数据）。
- 写路径（收款/退租）压测。
- 自动告警规则（OPS-04 已提供出口）。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | SLO 目标与判定在单一模块 | 单测 |
| 2 | 缺指标视为失败 | 单测 |
| 3 | CLI 退出码可用于发布闸门 | 代码审查 |
| 4 | 文档含执行命令、数据规模与频率 | docs/26 |
| 5 | 不影响现有门禁 | 仅脚本/文档 |

## 风险

- 基线依赖机器规格，跨环境不可直接比较。
- k6 脚本仍以读接口为主，写路径需后续扩展。
- 未在 CI 自动执行，发布前需人工跑并记录证据。
