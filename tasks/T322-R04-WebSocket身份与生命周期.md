---
status: active
execution_status: active
task_id: T322
plan_ref: COM-02
stage: M2
priority: P0
model_tier: 强
branch: feature/T322-websocket-lifecycle
start_time: 2026-10-25
blocked_by:
depends_on: T321
acceptance_evidence: tasks/evidence/T322.md
---

# T322：WebSocket 身份与连线生命周期（R04 / COM-02）

沿用 HTTP 账号存在、停用（`isActive`）与租客档案有效性检查。未激活或被停用账号在握手鉴权阶段被拒绝。来源 Origin 严格核对 CORS 白名单。

连线期间 Token 到期自动触发断开。用户停用、改密或全部登出会话撤销时，通过 `jwt.onUserRevoked` 监听钩子强制中止该用户既有 live WebSocket 连接。

补充 nginx `docker/nginx-admin.conf` 与 `docker/nginx-admin-tls.conf` 缺失的 `/socket.io/` 反代及协议升级配置；前端通知通道增加 `polling` 回退支持。
