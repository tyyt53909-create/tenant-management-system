---
status: active
execution_status: active
task_id: T254
plan_ref: OPS-03
stage: M1（可上线）
priority: P0
model_tier: 强
branch: feature/T254-ops-03
start_time: 2026-10-23
blocked_by:
depends_on: T253
acceptance_evidence: tasks/evidence/T254.md
handoff: docs/handoff/2026-10-23-T254-Nginx边界加固.md
---

# T254：Nginx 边界——上传上限、TLS、安全头与限流（OPS-03）

## 背景

nginx 默认 `client_max_body_size 1m`，手机照片直接 413；413 返回 HTML 而不是前端可解析的 JSON。HTTPS 只存在于注释模板里，安全头只有三项且会被 `location` 的 `add_header` 覆盖；边缘没有限流。`docs/19` 的 M1 要求「8MB 照片经 nginx 上传成功、11MB 回 413 JSON」，并完成 TLS 与安全头加固。

## 范围

- `docker/nginx-admin.conf`：
  - `client_max_body_size 10m`（与后端 `MAX_SIZE=10MB` 对齐），`8MB` 通过、`11MB` 返回 `413`。
  - 自定义 `error_page 413` → JSON `{"code":"PAYLOAD_TOO_LARGE",...}`。
  - 安全头：CSP、Permissions-Policy、X-Content-Type-Options、Referrer-Policy、X-Frame-Options；修正 `location = /index.html` 覆盖导致的安全头丢失。
  - 边缘限流：`limit_req_zone` 30r/s、burst 60、超限 429；`server_tokens off`。
  - 代理超时与 `proxy_request_buffering off`（上传流式转发）。
- 新增 `docker/nginx-admin-tls.conf`：8443 TLS 1.2/1.3、HSTS、HTTP/2、同套安全头与 413 JSON。
- 新增 `docker-compose.tls.yml`：叠加后发布 443 并挂载证书与 TLS 配置；默认部署保持纯 HTTP。
- 文档：`docs/12` 补充上传上限、TLS 启用步骤、安全头与限流说明。

## 非目标（拆到后续任务）

- 自动签发/续期证书（Let's Encrypt / certbot）：运维流程。
- 后端接口级限流参数调整：已有 `THROTTLE_*`。
- WAF / 地域封禁。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 8MB 上传经 nginx 不被 413 拦截 | 容器实测（`curl` 8MB body） |
| 2 | 11MB 返回 413 且 Content-Type 为 JSON | 容器实测 |
| 3 | HTTPS 入口可用，返回 HSTS 与安全头 | 自签证书 + 容器实测 |
| 4 | 静态页与 `/index.html` 均带完整安全头 | `curl -I` |
| 5 | API 边缘限流超限返回 429 | 容器实测 |
| 6 | 未叠加 TLS 时默认 HTTP 部署不受影响 | 现有 compose 启动 |
| 7 | `nginx -t` 通过 | 镜像内校验 |

## 文件归属

- `docker/nginx-admin.conf`、`docker/nginx-admin-tls.conf`（新增）、`docker-compose.tls.yml`（新增）
- `docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T254-ops-03`
- 工作树：`/home/user/development/worktrees/tenant-management-system/T254-ops-03`
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-23
- 状态：active

## 风险

- CSP 可能拦截前端动态加载的 Google GSI 脚本；已显式放行 `https://accounts.google.com`，上线前需人工点一次 Google 登录。
- `limit_req` 与后端限流叠加可能让批量上传更早触发 429；burst 60 已留余量。
- 10m 上限对超大原图仍会 413；前端已有压缩，必要时后续提高到 15m 并同步后端。
