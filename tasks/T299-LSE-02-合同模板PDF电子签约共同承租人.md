---
status: active
execution_status: in_progress
task_id: T299
plan_ref: LSE-02
stage: M4
priority: P1
model_tier: 强
branch: feature/T299-contract-template-sign-cotenants
start_time: 2026-10-26
completed_time:
blocked_by:
depends_on: FIN-01, DEC-05, SEC-07, WX-01
acceptance_evidence: tasks/evidence/T299.md
handoff: docs/handoff/2026-10-26-T299-合同模板PDF电子签约共同承租人.md
---

# T299：合同模板、PDF、电子签约与共同承租人（LSE-02）

## 背景与目标

根据生产化第二轮路线图（`docs/19-生产化路线图.md`）M4 里程碑规划以及决策拍板 **DEC-05（采用第三方电子签）**，系统需要推进从签约到入住的闭环流转，补齐纸质与电子混合签约、多人合租协同与标准化文本渲染能力：

1. **共同承租人（Co-tenants）**：
   - 支持合同关联多位共同承租人/合租人，支持登记姓名、手机号、证件类型、加密证件号、关系与是否作为共同签署人；
   - 租客端查询合同详情可查看共同承租人并安全脱敏。
2. **合同条款模板（ContractTemplate）**：
   - 新增 `ContractTemplate` 实体与迁移，管理端支持标准条款模板的维护与变量占位符替换；
   - 预置默认标准租赁合同模板。
3. **合同 PDF 预览与标准导出**：
   - 实现 `GET /api/contracts/:id/pdf` 导出符合规范的标准租赁合同 PDF，包含承租双方、房屋与费用、共同承租人清单、物业条款与签名防伪戳。
4. **第三方电子签约（DEC-05）**：
   - 抽象 `ElectronicSignProvider` 接口与 `MockElectronicSignProvider`；
   - 在 `Contract` 引入 `signStatus`、`signFlowId`、`signedAt` 等状态追踪；
   - 提供签约流程发起、状态查询、公网回调 Webhook 与模拟签署；签署完成自动归档合同附件并触发系统通知。
5. **真实数据库测试与全门禁**：
   - 编写 `backend/test/integration/contract-template-sign-cotenants.int-spec.ts` 真实数据库集成测试（BE-INT）；
   - 更新 OpenAPI 规范并同步前端类型，通过全部 CI 门禁。

## 验收标准

- [x] 新增 `ContractTemplate` 与 `ContractCoTenant` 实体，数据库迁移成功应用。
- [x] 合同支持管理与渲染共同承租人信息，敏感证件加密存储且查询时脱敏。
- [x] 管理端支持合同模板 CRUD，生成合同文本支持变量占位符自动解析。
- [x] 提供标准合同 PDF 导出端点，零依赖流式生成。
- [x] 电子签约抽象接口落地，支持发起签约、状态流转、签名回调与附件自动归档。
- [x] 全套单元测试与真实 PostgreSQL 数据库集成测试通过，OpenAPI 契约无漂移。
