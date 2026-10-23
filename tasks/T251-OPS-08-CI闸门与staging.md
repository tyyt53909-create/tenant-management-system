---
status: draft
execution_status: draft
task_id: T251
plan_ref: OPS-08
stage: M0（生产化收口）
priority: P0
model_tier: 强
branch:
depends_on: T250
blocked_by: needs-human
acceptance_evidence: tasks/evidence/T251.md
handoff:
---

# T251：CI 闸门与 staging（OPS-08）

## 背景

M0 的目标是「决策拍板 + 基线可部署」。T250 只完成治理收口；真正的 CI 闸门与 staging 环境仍未落地。当前仓库的 CI 覆盖不全：依赖审计不阻断、无镜像扫描/SBOM、小程序构建与安全扫描未纳入统一闸门，也没有可一键部署的 staging 供 M1 验证。

本任务承接 OPS-08，属于 **M0 剩余项**。在 T250 合并且本任务被正式派发前，不得开工。

## 范围（草案）

- CI 统一闸门：后端 lint/tsc/unit/e2e、前端 lint/unit/build、小程序 unit/build、OpenAPI 生成物、docs-check、task-check 全部阻断。
- 供应链安全：`npm audit` High/Critical 阻断、镜像扫描、SBOM 产出与留存。
- staging：一键部署（Compose 或等价方案）、独立数据库/Redis、HTTPS、smoke 脚本（健康检查 + 登录 + 房源列表）。
- 失败可诊断：CI 产物保存测试报告与 gate 证据，供 `collect-gates.mjs` 消费。
- 与 `docs/19` 的 M0 闸门对齐：staging 可一键部署、prod-smoke 可重复执行。

## 验收（待细化）

| # | 标准 | 验证 |
|---|---|---|
| 1 | 任一必需检查失败会阻断 PR | 故意制造失败 |
| 2 | High/Critical 依赖或镜像漏洞阻断 | CI 日志 |
| 3 | staging 可从空环境一键部署并通过 smoke | 部署记录 |
| 4 | gate 证据可被看板脚本读取 | `collect-gates.mjs` 输出 |
| 5 | 文档与 INDEX 同步，handoff 完成 | CI |

## 依赖与阻塞

- `depends_on: T250`（路线图与字段先落地）。
- `blocked_by: needs-human`：staging 主机/域名/凭据与 CI 权限需人工提供；DEC-07 部署形态未拍板前不锁定方案。

## 备注

- 本文件只是 draft；派发时补全验收标准、文件归属与估时。
- 不修改 `docs/06`、`docs/17`、`docs/18`、`tasks/T231–T248`。
