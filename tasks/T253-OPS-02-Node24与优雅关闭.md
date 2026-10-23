---
status: completed
execution_status: completed
task_id: T253
plan_ref: OPS-02
stage: M1（可上线）
priority: P0
model_tier: 强
branch: feature/T253-ops-02
start_time: 2026-10-23
complete_time: 2026-10-23
merge_commit: 46a07ff
blocked_by:
depends_on: T252
acceptance_evidence: tasks/evidence/T253.md
handoff: docs/handoff/2026-10-23-T253-Node24与优雅关闭.md
---

# T253：Node 24 LTS、优雅关闭与镜像加固（OPS-02）

## 背景

`docs/19` OPS-02 要求关闭两个 P0：`ISS-15` Node 20 已 EOL、`ISS-16` 无优雅停机。当前后端镜像仍是 `node:20-alpine`；`main.ts` 未启用 shutdown hooks，`RedisService` 没有销毁钩子；生产容器收到 SIGTERM 后可能直接断开请求与 Redis/Prisma 连接。

## 范围

- 后端镜像升级到 `node:24-alpine`（三个构建阶段一致），并把健康检查探针改为 `/api/health/live`。
- 启用 Nest 优雅关闭：`app.enableShutdownHooks()`，SIGTERM/SIGINT 触发 `app.close()`；超过宽限期强制退出，避免容器被 SIGKILL。
- `RedisService` 增加 `OnModuleDestroy`：优先 `QUIT`（限时），失败或超时后 `disconnect`，不阻塞停机。
- 生产编排加固：`init: true`、`stop_grace_period: 30s`、只读根文件系统 + `/tmp` tmpfs、`cap_drop: ALL`、`no-new-privileges`。
- 文档更新：README/AGENTS 标明生产镜像 Node 24（CI 仍为 Node 20，统一到 24 由 OPS-08 处理）；部署文档补充停机与探针说明。

## 非目标（拆到后续任务）

- 升级 CI/本地开发 Node 版本：OPS-08 统一处理。
- nginx 上传上限、TLS、安全头：OPS-03。
- 定时任务进行中的作业排空（BullMQ）：后续队列任务。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 镜像基于 Node 24 LTS，构建期 Prisma 引擎断言仍生效 | `docker build` |
| 2 | 收到 SIGTERM 后 30 秒内退出；正常情况先完成 `app.close()` | 单元测试 + 容器实测 |
| 3 | Redis 在停机时执行 `QUIT`，失败时回退 `disconnect` 且不抛错 | 单元测试 |
| 4 | 超时未关完时强制退出并记录错误日志 | 单元测试 |
| 5 | 生产 compose 以只读根文件系统、非 root、无新增特权运行，上传卷可写 | `docker compose config` + 启动冒烟 |
| 6 | 健康检查指向 `/api/health/live` | Dockerfile / compose 检查 |
| 7 | 后端 lint / tsc / unit 通过 | `npm run lint && npx tsc --noEmit && npm test` |

## 文件归属

- `backend/src/config/shutdown.config.ts`（新增）、`shutdown.config.spec.ts`（新增）
- `backend/src/main.ts`
- `backend/src/redis/redis.service.ts`、`redis-shared.spec.ts`
- `backend/Dockerfile`
- `docker-compose.prod.yml`
- `README.md`、`AGENTS.md`、`docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T253-ops-02`
- 工作树：`/home/user/development/worktrees/tenant-management-system/T253-ops-02`
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-23
- 完成日期：2026-10-23
- 合并：PR #56，merge commit `46a07ff`
- 状态：completed

## 风险

- Node 24 与 Prisma 5.22 的 musl 引擎需在镜像构建时验证；Dockerfile 已有的架构/引擎断言可在构建期拦截。
- 只读根文件系统可能暴露运行时写盘依赖；以容器启动 + 健康检查验证，必要时补 tmpfs 或可写卷。
- CI 仍为 Node 20，与生产 24 存在版本差；由 OPS-08 收敛，本轮在文档中明确标注。
