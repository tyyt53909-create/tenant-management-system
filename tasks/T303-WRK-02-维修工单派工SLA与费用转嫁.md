---
status: completed
execution_status: completed
task_id: T303
plan_ref: WRK-02
stage: M4
priority: P1
model_tier: 强
branch: feature/T303-maintenance-dispatch-sla
merge_commit: 50e9de0
start_time: 2026-10-26
completed_time: 2026-10-26
blocked_by:
depends_on: WRK-01, COM-02, COM-03
acceptance_evidence: tasks/evidence/T303.md
handoff: docs/handoff/2026-10-26-T303-维修工单派工SLA与费用转嫁.md
---

# T303：维修工单：派工、SLA、员工端、费用转嫁（WRK-02）

## 背景与目标

根据生产化第二轮路线图（`docs/19-生产化路线图.md`）M4（全生命周期与协作）规划以及 WRK-01（T302 员工多角色体系）已落地的基础，进一步完成工单处理全流程闭环：

1. **维修派工与全角色协作（Dispatch & Staff Collaboration）**：
   - 管理员 / 物业管家（`PROPERTY_MANAGER`）可为待处理工单指派具体的维修师傅（`MAINTAINER`）；
   - 支持管家基于负责楼栋管辖范围进行工单过滤与派工调度；
   - 保持工单状态机（`SUBMITTED -> ACKNOWLEDGED -> ASSIGNED -> IN_PROGRESS -> PENDING_CONFIRM -> COMPLETED / CANCELLED`）的完整语义与时间线（`MaintenanceMessage`）自动沉淀。
2. **SLA 时限与监控告警（Service Level Agreement）**：
   - 按报修工单优先级（`URGENT` 2h 响应 / 24h 解决；`NORMAL` 12h 响应 / 48h 解决；`LOW` 24h 响应 / 72h 解决）自动计算响应死线（`responseDueAt`）与解决死线（`slaDueAt`）；
   - 跟踪记录首次响应时间（`firstRespondedAt`）；
   - 提供 SLA 超时预警与超时标记（`isSlaBreached`, `slaBreachedAt`, `slaBreachType`）；
   - 提供 `GET /maintenance/sla-alerts` 供管家与管理员及时跟进超时工单。
3. **维修工专属端（Maintainer Portal）**：
   - 维修师傅专属端点 `GET /maintenance/assigned` 查看指派给本人的工单；
   - 维修工接单开工端点 `POST /maintenance/:id/start`（流转至 `IN_PROGRESS`）；
   - 维修工完工提报端点 `POST /maintenance/:id/complete`（填写处理说明、工时与材料费用、责任判定，流转至 `PENDING_CONFIRM` 等待租客/管理员验收）。
4. **费用转嫁（Expense Transfer to Tenant）**：
   - 针对租客过失或消耗品自费产生的维修（`tenantFault: true`），支持将维修总费用（工时费 + 材料费）一键转嫁为租客账单（`Bill`，`billType: MAINTENANCE`）；
   - 账单与工单原子关联（`expenseBillId`、`expenseTransferred: true`），幂等防重复转嫁；
   - 租客端可在账单列表中完成在线缴费闭环。
5. **真实数据库测试与全门禁**：
   - 编写 `backend/test/integration/maintenance-sla-dispatch.int-spec.ts` 真实数据库集成测试（BE-INT）；
   - 保证单元测试覆盖率 ≥ 85.0%，OpenAPI 路由契约 100% 同步，全门禁绿灯。

## 验收标准

- [x] 数据模型扩充：`MaintenanceRequest` 增加 SLA 时限、首次响应时间、超时标记、维修工关联以及费用转嫁字段；`BillType` 增加 `MAINTENANCE`；表数严格维持 55 张。
- [x] 派工调度：管家与管理员可通过端点或更新为工单指派维修工，记录派工时间与时间线事件，支持管辖楼栋数据隔离。
- [x] SLA 监控：工单创建时自动按优先级计算响应与解决死线，状态流转记录首次响应时间并标记响应/解决超时，提供 SLA 超时工单告警列表端点。
- [x] 维修工端点：维修师傅可查询指派给本人的工单列表、接单开工、提报完工说明与维修用料成本。
- [x] 费用转嫁：支持将租客责任维修费用一键转嫁生成租客维修账单，幂等防重复生成，并与对应合同与租客关联。
- [x] 编写真实 PostgreSQL 集成测试（BE-INT）并跑通全部质量门禁（lint、test:cov、test:int、test:e2e、check-docs、task-check）。
