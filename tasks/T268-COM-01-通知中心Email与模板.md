---
status: completed
execution_status: completed
task_id: T268
plan_ref: COM-01
stage: M1
blocked_by:
acceptance_evidence: tasks/evidence/T268.md
branch: feature/T268-com-01
complete_time: 2026-10-24
merge_commit: 52b19b0
handoff: docs/handoff/2026-10-24-T268-通知中心Email与模板.md
---

# T268：COM-01 通知中心 Email 与模板（M1 部分）

## 目标与边界

交付真实 SMTP 邮件 transport、可注入 transport 的 EmailChannel，以及 RENT_BILL、CONTRACT_EXPIRED、MAINTENANCE、GENERIC 邮件模板。邮件模板提供 HTML 与 text，未知模板回退 GENERIC；SMTP 未配置时生产环境记录错误并 fail-closed，开发/测试不发送。渠道投递错误必须隔离，不阻断其他渠道。

不新增资料表、不修改 Prisma Schema。持久化 Outbox、BullMQ 投递重试与通知偏好属于后续 OPS-05 / COM-01 剩余工作，不在本任务范围。

## 验收

- SMTP 使用环境变量配置并由 nodemailer 发送；配置无效时明确报错。
- EmailChannel 支持收件人、标题、模板 text/HTML 与注入 fake transport。
- 未配置 SMTP 时生产发送拒绝且记录错误；非生产环境不发送。
- 通知模板 HTML 对内容进行转义，未知模板回退 GENERIC。
- Dispatcher 隔离渠道异常，其他渠道仍可处理。
- `tasks/evidence/T268.md` 记录要求的 TypeScript、lint、模块测试结果。
