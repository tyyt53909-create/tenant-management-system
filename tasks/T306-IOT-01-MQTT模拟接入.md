---
status: active
owner_tier: strong
applies_to:
  - backend/src/modules/meters/adapters/mqtt-telemetry.ts
last_verified: 2026-10-29
verified_commit: 46f38da
supersedes: null
superseded_by: null
version: 1.0
---

# T306 MQTT 模拟接入：进行中

基线 `46f38da`，分支 `feature/t306-mqtt-local`。路线图将 FIN-08 / T274、OPS-04 / T277、OPS-05 / T278 标为 completed；本任务未重新验证其生产环境状态。ADR-003 与现有 CLI 模拟器约定 `tenant-system/meters/{meterType}/{meterNumber}/telemetry`、JSON `messageId`、`meterNumber`、`meterType`、`timestamp`、`reading`；这是模拟协议，不代表任何供应商协议。

本切片仅实现遥测解析和明确绑定校验，转交 `SIMULATED`、`autoSettle=false` 的读数请求，不转发客户端备注、结算、翻转或初始化控制字段。无模块注册、订阅、连接或默认启动，不能作为已完成的 MQTT 接入使用。17 个边界测试与现有读数服务、去重单元测试共 31 项通过；后端类型检查通过、lint 通过但有既有警告。

未完成：MQTT 消费生命周期、QoS 持久交付和失败处理、断线重连与重投、并发/乱序真实数据库测试、隔离 DB 与 loopback broker 端到端验证、监控及硬件联调。现有读数服务查询最新读数时包括 SIMULATED，可能影响真实读数基准；因此不可将此切片接入真实或混合数据库，必须先解决隔离并测试。当前 Docker daemon 不可用，未建立隔离数据库或 broker；不要连接既有服务代替。未改变 schema、历史账单或数据，未推送、部署或连接设备。
