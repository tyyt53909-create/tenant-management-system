---
status: completed
execution_status: completed
task_id: T295
plan_ref: PAY-03
stage: M3
priority: P1
model_tier: 强
branch: feature/T295-receipt-pdf-verify
start_time: 2026-10-25
complete_time: 2026-10-25
merge_commit: d633496
blocked_by:
depends_on: FIN-05, DEC-09, SEC-07
acceptance_evidence: tasks/evidence/T295.md
handoff: docs/handoff/2026-10-25-T295-收款收据与防伪验真.md
---

# T295：收据：连续编号、PDF、验真、作废（PAY-03）

## 背景与目标

根据生产化路线图（docs/19 §4/§5 里程碑 M3）与架构决策 DEC-09（押金与发票：先不开票，押金可转续约；电子收据是主要法定合规收款凭证），在完成线上收款（PAY-01）与退款对账（PAY-02）后，构建全链路收据凭单系统：

1. **连续编号与收据模型升级**：
   - 依托数据库序列（`payment_receipt_seq`）按业务日原子生成连续收据编号（`R{YYYYMMDD}{000001}`）。
   - 强化 `BillReceiptService` 支持单笔支付记录收据与整单收据维度的完整数据装配，覆盖租金、押金（DEC-09）、水电费等全部账单类型。
   - 建立密码学防伪校验码（`verifyCode`）生成机制（基于收据号、金额、收款时间等关键要素生成安全 HMAC 防伪摘要）。
2. **收据作废与状态联动**：
   - 当收款被作废（`voidPayment`）或退款冲正时，收据状态同步呈现 `VOIDED`（`已作废`）。
   - 包含明确作废元信息（作废时间 `voidedAt`、作废原因 `voidReason`、操作人 `voidedBy`）。
   - 已作废的收据无论在数据接口、PDF 还是在线验真页面，均显著标记作废标识，防止已被作废的凭单被冒用。
3. **公开收据验真端点**：
   - 暴露公开接口 `GET /api/public/receipts/:receiptNumber/verify`（`@Public()`）。
   - 支持根据收据号与防伪码实时查验凭单真伪及有效性。
   - 严格执行隐私脱敏（SEC-08）：交款租客姓名脱敏为 `张*`，手机脱敏为 `138****0001`，防止隐私外泄。
4. **收据 PDF 标准化生成与导出**：
   - 暴露管理端与租客端 PDF 导出端点：
     - `GET /api/bills/:id/payments/:paymentId/receipt/pdf`
     - `GET /api/bills/:id/receipt/pdf`
     - `GET /api/public/receipts/:receiptNumber/pdf`
   - 提供标准 PDF 1.4 生成器，输出带双语抬头、单据要素、大写金额、防伪码、在线验真说明的合规收款凭证；若作废则渲染「VOIDED / 已作废」红色印章与作废说明。
   - 返回标准 `application/pdf` 流与正确的 `Content-Disposition` 响应头。
5. **门禁与测试保障**：
   - 补充单元测试、覆盖率检查（保持全量达标）、OpenAPI 契约更新及真实 PostgreSQL 数据库测试。

## 验收标准

- [x] 收据支持连续编号与安全防伪验真码（`verifyCode`）计算。
- [x] 暴露公开验真端点 `GET /api/public/receipts/:receiptNumber/verify`，支持有效性与作废状态查验，并对敏感信息脱敏。
- [x] 暴露收据 PDF 导出端点，生成标准合法 PDF 1.4 文档流（`application/pdf`）。
- [x] 当收款作废时，收据数据与 PDF 均同步体现 `VOIDED` 状态与作废原因。
- [x] 真实 PostgreSQL 数据库集成测试覆盖收据生成、作废状态流转、公开验真与 PDF 导出。
- [x] OpenAPI、代码检查与全套门禁全绿。
