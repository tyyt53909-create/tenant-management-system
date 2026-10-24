---
status: active
owner_tier: strong
applies_to:
  - .github/workflows/deploy-staging.yml
  - .github/workflows/release.yml
  - docker-compose.staging.yml
  - scripts/smoke.mjs
last_verified: 2026-10-24
verified_commit: 68c0fac
supersedes: null
superseded_by: null
version: 1.0
---

# staging 与发布闸门（OPS-08 / T251）

> 本文是「代码合入 → 镜像 → staging → 冒烟 → 回滚」的唯一操作入口。
> 生产部署仍见 `docs/12-部署与运维.md` §7；staging 不触碰生产。

## 1. 环境拓扑

| 环境 | 编排 | 镜像来源 | Node | 用途 |
|---|---|---|---|---|
| 本地 | `docker-compose.yml`（PostgreSQL + Redis + Mosquitto） | 本地构建 | 22（CI/本地） | 开发与单测 |
| staging | `docker-compose.staging.yml` | GHCR 不可变标签 | 生产镜像 `node:24-alpine` | 预发验收、UAT、迁移演练 |
| 生产 | `docker-compose.prod.yml` | GHCR `vX.Y.Z` | `node:24-alpine` | 真实收租 |

staging 与生产使用同一镜像、同一迁移，只替换环境变量与端口；staging 数据库/密钥必须独立。

## 2. 一次性准备

### 2.1 主机

- 一台 Linux 主机（2C4G 起），安装 Docker Engine 与 Compose v2；
- 目录例如 `/srv/tenant-staging`，放入：
  - `docker-compose.staging.yml`
  - `.env.staging`（从 `.env.staging.example` 复制，`chmod 600`）
  - `certs/`（如启用 HTTPS）
- 防火墙只暴露 `WEB_PORT`（默认 8080）或前置反代。

### 2.2 GitHub Repository secrets

| Secret | 说明 |
|---|---|
| `STAGING_HOST` | 主机域名或 IP |
| `STAGING_USER` | SSH 用户（建议专用、仅 docker 权限） |
| `STAGING_SSH_KEY` | 私钥（ed25519，只读部署目录） |
| `STAGING_KNOWN_HOSTS` | 主机公钥（`ssh-keyscan -H <host>`，禁止 `StrictHostKeyChecking=no`） |
| `STAGING_DIR` | 主机上的编排目录，如 `/srv/tenant-staging` |
| `STAGING_URL` | 对外的 API 根地址，如 `https://staging.example.com/api` |

> 未配置以上 secrets 时，`deploy-staging.yml` 会在「校验输入与 secrets」步骤明确失败，不会半部署。

## 3. 首次部署

1. 在本地/CI 打出不可变标签（commit SHA 或 `vX.Y.Z`）。
2. 确认镜像已推送 GHCR（`release.yml`）。
3. 在主机准备好 `.env.staging` 后，运行：
   - Actions → **Deploy Staging** → Run workflow；
   - `image_tag` 填 SHA 或版本号；
   - `rollback=false`。
4. workflow 会：SSH 拉取镜像 → `migrate deploy` → `up -d` → 等待 `/health/ready` → 跑 `scripts/smoke.mjs`。
5. 首次种子（仅一次）：
   ```bash
   cd /srv/tenant-staging
   TAG=<sha> docker compose -f docker-compose.staging.yml --env-file .env.staging \
     --profile seed run --rm seed
   ```

## 4. 日常部署与回滚

- 日常：同一 workflow，填写新 SHA。
- 回滚：
  ```bash
  gh workflow run deploy-staging.yml -f image_tag=<上一个可用标签> -f rollback=true
  ```
  或直接在主机把 `TAG` 改为上一个标签后 `up -d`。
- 数据库迁移为 expand/contract；回滚镜像不自动回滚 schema。涉及删列/改类型的 contract 迁移必须单独评审。

## 5. 冒烟清单

`scripts/smoke.mjs` 自动检查：

- `GET /health` → 200
- `GET /health/ready` → 200（DB/Redis 就绪）
- `GET /public/rooms` → 200 且为合法 JSON
- `GET /public/files/__smoke_missing__` → 404（不泄露存在性）

人工补充（每次发布）：

- [ ] 管理员登录 → 仪表板数据加载
- [ ] 新建房源 + 上传 8MB 照片 → 公开看房页可见
- [ ] 预建租客 + 邀请码 → 租客首次登录绑定成功
- [ ] 生成账单 → 收款 → 收据 PDF/编号
- [ ] 报修 → 派单 → 完成
- [ ] 退租结算 → 押金退还

## 6. 发布闸门（Go / No-Go）

Go 条件（全部满足）：

- PR 的 10 个 required checks 全绿（含 backend e2e、e2e-mvp、Playwright、status gates）；
- `release.yml` 的 Trivy 扫描无 HIGH/CRITICAL（`ignore-unfixed=true`）；
- 生产依赖 `npm audit --omit=dev --audit-level=high` 无漏洞；
- staging 部署成功且 `smoke.mjs` 全绿；
- 人工 UAT 清单完成并记录在 `docs/handoff/`。

No-Go：

- 任一 required check 失败；
- 迁移在 staging 失败或耗时异常；
- 冒烟失败且 30 分钟内无法定位；
- 发现 HIGH/CRITICAL 漏洞且无人工例外记录。

## 7. 已知限制

- 本任务未提供真实 staging 主机，外部部署标记 **NOT_RUN**；配置 secrets 后需人工执行一次并回填证据。
- 蓝绿/金丝雀、自动回滚、CDN purge 不在范围。
- `docker-compose.staging.yml` 为拉取镜像模式，不支持在主机上 `--build`。
