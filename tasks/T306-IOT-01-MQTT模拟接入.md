---
status: active
owner_tier: strong
applies_to:
  - backend/src/modules/meters/adapters/mqtt-telemetry.ts
  - backend/src/modules/meters/adapters/mqtt-simulator-consumer.ts
last_verified: 2026-10-29
verified_commit: 46f38da
supersedes: null
superseded_by: null
version: 1.1
---

# T306 MQTT 模拟接入：本地切片

基线 `46f38da`，分支 `feature/t306-mqtt-local`。路线图将 FIN-08 / T274、OPS-04 / T277、OPS-05 / T278 标为 completed；本任务未重新验证其生产环境状态。ADR-003 与现有 CLI 模拟器约定 `tenant-system/meters/{meterType}/{meterNumber}/telemetry`、JSON `messageId`、`meterNumber`、`meterType`、`timestamp`、`reading`；这不是供应商协议。

遥测解析限制大小、格式、数值与时间，并以明确指定的表 ID、楼栋、表号、类型和启用状态匹配；只传入 SIMULATED、autoSettle=false，不传入备注、结算、翻转或初始化字段。模拟消息去重键独立，历史模拟键若与真实键冲突则拒绝并要求人工核对。单笔/批量读数比较、乱序查询、管理摘要与对账排除模拟读数；模拟序列单独加锁并拒绝旧时间。同步纳入另一分支 T324 提交 `c42c6c5` 的保留结算标记防伪及其集成测试；未迁移或重算历史数据。

`npm run simulate:mqtt:consumer` 是手动启动的本地测试入口，不注册到应用；缺少 `MQTT_SIMULATOR_ENABLED=true` 即拒绝。还必须提供 `NODE_ENV=test`、现有整合测试环境变量 `ALLOW_INTEGRATION_RESET`、`INTEGRATION_DATABASE_URL`、`INTEGRATION_DATABASE_MARKER`、`INTEGRATION_REDIS_URL`，使用已标记且非超级用户的隔离库；另需 `MQTT_SIMULATOR_BROKER=mqtt://127.0.0.1:<port>` 和 `MQTT_SIMULATOR_BINDING` JSON（meterId、buildingId、meterNumber、meterType）。数据库和 Redis 主机也必须是 127.0.0.1。禁止使用真实或混合数据库；该脚本不配置真实设备、认证或外部 broker。仅订阅指定表 QoS 1，重连间隔 2 秒，关闭时断开。无效消息拒绝，写库失败不发 PUBACK 并断开；消息持久性依赖 broker 会话配置。

验证：后端完整单元 1728 项通过，之后新增配置测试 7 项通过；后端 build 类型检查、lint（既有警告）与文档/契约检查通过。全新临时 PostgreSQL、Redis 与仅监听 loopback 的最小测试 MQTT broker：真实 MQTT 包经消费者写入隔离 DB，断线重连后发布端重送同一 messageId 仅一笔，非法值/错表/旧时间被拒，真实读数及对账排除模拟数据；相关 DB 集成共 6 项通过，含 T324 防伪。后续改动涉及的单元测试 159 项通过。标记和非超级用户检查通过后才允许测试 reset。

未完成：测试 broker 不是完整生产 broker，未验证 broker 离线持久会话、异常写入后的真实 broker 自动重投、真实硬件/供应商协议、生产级 ACL/TLS、OPS-04 告警与 OPS-05 队列/死信联动，不应标记 T306 整体完成或投入真实环境。无外部连接、schema 变更、历史账单重算、推送或部署。
