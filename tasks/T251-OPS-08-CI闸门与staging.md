---
status: active
execution_status: active
task_id: T251
plan_ref: OPS-08
stage: M0
priority: P0
model_tier: 强
branch: feature/T251-ops-08
start_time: 2026-10-24
complete_time:
merge_commit:
blocked_by:
depends_on:
acceptance_evidence: tasks/evidence/T251.md
handoff: docs/handoff/2026-10-24-T251-CI闸门与staging.md
---

# T251：CI 闸门、供应链安全与 staging（OPS-08）

## 背景

`docs/19` M0 的剩余出口是「staging 可一键部署」。当前状态：

- 6 个 CI workflow 分别跑后端/后台/小程序/文档/状态/安全，但 Node 版本仍为 20；管理后台依赖（`@vueuse/core@15`、`ast-walker-scope`）已声明需要 Node ≥22。
- 生产镜像自 T253 起为 `node:24-alpine`，本地/CI 20 与生产 24 存在差异。
- 只有生产 compose（`docker-compose.prod.yml`）与镜像发布（`release.yml`），没有 staging 编排、部署流程与发布后冒烟。
- 镜像发布后没有容器漏洞扫描。

本任务把「代码合入 → 镜像 → staging → 冒烟 → 可回滚」串成可执行路径，并把 CI 版本对齐到 Node 22 LTS。

## 范围

### 1. CI 版本统一

- 所有 GitHub Actions `node-version` 统一为 **22**（本地开发同步建议 22；生产镜像保持 24）。
- 更新 `AGENTS.md` 技术栈说明与 `docs/12` 的版本口径。
- 验证三端在 Node 22 下 lint / test / build 全部通过。

### 2. 供应链安全

- `release.yml` 增加镜像漏洞扫描（Trivy），发现 `HIGH` / `CRITICAL` 时失败。
- 依赖审计沿用 `security-scan.yml` 的 `npm audit`；补充 `npm audit --omit=dev --audit-level=high` 作为生产依赖门禁。
- 镜像以 digest/commit SHA 作为不可变标签之一（`type=sha`）。

### 3. staging 编排与部署

- 新增 `docker-compose.staging.yml`：复用生产镜像，独立项目名/卷/端口，`restart: unless-stopped`，健康检查与资源限制。
- 新增 `.env.staging.example`（与 env schema 对齐，占位值明确不可用于生产）。
- 新增 `.github/workflows/deploy-staging.yml`：
  - `workflow_dispatch` 输入 `image_tag`（必填）与 `rollback`（可选）；
  - 通过 SSH 在 staging 主机执行 `docker compose pull && up -d`；
  - 部署后跑 `scripts/smoke.mjs`（`/health`、`/health/ready`、`/public/rooms`、`/public/files/:key` 不可匿名读私有对象）；
  - 失败时输出回滚指令，不自动改生产。
- 新增 `scripts/smoke.mjs`：纯 Node，无第三方依赖，支持 `BASE_URL` 与超时。

### 4. 发布闸门文档

- 新增 `docs/20-staging与发布闸门.md`：环境拓扑、secrets 清单、部署/回滚步骤、冒烟清单、Go/No-Go 条件。
- `docs/12` 增加 staging 小节并链接 `docs/20`；`docs/INDEX` 登记。
- `docs/19` OPS-08 状态置 active。

## 非目标

- 不在本任务采购/开通真实 staging 主机；外部部署标记 **NOT_RUN**，由人工配置 secrets 后执行。
- 不引入 Kubernetes / Terraform。
- 不做蓝绿或金丝雀发布。
- 不改生产 compose 的端口与域名策略。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 所有 workflow 使用 Node 22 | `grep node-version` 全部为 22 |
| 2 | Node 22 下三端 lint/test/build 通过 | 本地实测 + PR CI |
| 3 | 镜像发布含 HIGH/CRITICAL 扫描门禁 | `release.yml` Trivy 步骤；本地 `docker build` 可选 |
| 4 | staging compose 可 `config` 解析 | `docker compose -f docker-compose.staging.yml config`（无 secrets 用 example） |
| 5 | 部署后冒烟脚本可独立运行 | `BASE_URL=... node scripts/smoke.mjs`（本地用已启动后端验证） |
| 6 | 部署文档覆盖 secrets、回滚、Go/No-Go | `docs/20` |
| 7 | 全量 CI、docs-check 通过 | PR checks |

## 文件归属

- `.github/workflows/*.yml`（node-version、release、deploy-staging）
- `docker-compose.staging.yml`、`.env.staging.example`
- `scripts/smoke.mjs`、`scripts/smoke.spec.mjs`（如适用）
- `docs/20-staging与发布闸门.md`、`docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`
- `AGENTS.md`（仅版本口径）

## 开发信息

- 分支：`feature/T251-ops-08`
- 基线：`c825d74`（含 T262 回填）
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-24
- 状态：in_progress

## 风险

- Node 22 统一会改变 CI 运行时；后台依赖已要求 ≥22，预计减少 engine 警告，但需观察原生模块（bcrypt/sharp）预编译包。
- staging 部署依赖人工 secrets（SSH key、host、env）；未配置前只能验证 compose 解析与冒烟脚本，不能声称「已部署」。
- Trivy 首次扫描可能因基础镜像漏洞失败；按「High/Critical 阻断、Medium 记录」处理，紧急放行需人工记录例外。
