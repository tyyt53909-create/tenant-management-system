---
status: active
owner_tier: strong
applies_to:
  - scripts/e2e-mvp/**
  - backend/src/modules/checkout/**
last_verified: 2026-10-13
verified_commit: 13ee2a9
supersedes: null
superseded_by: null
version: 1.0
---

# T147 MVP 端到端验收脚本

## 目标
把「可交给真实用户试用」的主流程固化为可重复执行的端到端脚本，覆盖验收标准第 3 节 14 步，
并覆盖越权 / 幂等 / 并发三类必须测试场景（AGENTS.md §7.2）。

## 交付物
| 文件 | 说明 |
|---|---|
| `scripts/e2e-mvp/run.mjs` | 端到端脚本，26 项断言，自建数据、可重复运行、退出码表结论 |
| `backend/src/modules/checkout/dto/create-checkout.dto.ts` | 新增 CheckoutItemDto 与 `items?: CheckoutItemDto[]` |
| `backend/src/modules/checkout/checkout.service.ts` | `create()` 改为事务，主记录与结算明细同时落库 |

## 用法
```bash
# 默认 http://127.0.0.1:3100/api
node scripts/e2e-mvp/run.mjs

# 覆盖 API 地址
API_BASE=http://127.0.0.1:3000/api node scripts/e2e-mvp/run.mjs
```

推荐先跑 `docs/handoff/2026-10-13-T148-*.md` 描述的本地环境准备（`.env` + 迁移 + seed）。

## 覆盖范围
- 主流程：管理员登录 → 建房源 → 建租客并注册账号 → 合同生效 → 月度账单 → 收款至 PAID →
  预付充值 → 水电读数自动扣费 → 租客报修 → 报修流转至 COMPLETED → 退租结算（含押金扣除项）→
  房间转 PENDING_CLEAN 并通知保洁 → 保洁标记已清洁 → 租客数据隔离
- 越权：未登录 401、租客调管理接口被拒、保洁读租客/合同/账单 403、保洁读非待清洁房间 403
- 幂等：同一交易号重复收款 409
- 并发：房态乐观锁 version 冲突 409（A6 用 DRAFT 合同隔离前置条件影响）

## 修复的产品缺口
退租结算明细（含押金扣除项）原本**无法经 API 创建**：`CheckoutItem` 表与
`CheckoutItemType.DEPOSIT_DEDUCTION` 枚举早已存在，但 `CreateCheckoutDto` 只有 `totalRefund`，
没有任何写入路径，导致「押金扣除项必须有类别/金额/说明」无法满足。本任务补齐 DTO 与服务写入，
无需 schema 变更（不违反迁移串行约束）。

## 实测记录（脚本注释中已固化，供后续维护者参考）
1. `VACANT+CLEAN -> RESERVED+CLEAN` 的前置条件是「存在草稿合同」，故合同须先 DRAFT、流转到 RESERVED 后再激活。
2. 已 PAID 的账单再次收款会先被「账单为 PAID 状态，不可收款」拦截（400），幂等 409 必须用仍可收款的账单（PARTIAL）验证。
3. 房态流转**前置条件校验先于乐观锁**：前置不满足返回 400，只有流转本身合法而版本过期才返回 409。
4. 注册接口会新建一条独立 Tenant 档案；租客侧接口以服务端注入的 `user.tenantId` 为准，
   因此用管理员手工建的租客无法代替注册租客做租客侧验证。
5. 邀请码由 seed 每次重新生成，脚本改用 `POST /api/auth/invite-codes` 动态获取。

## 验收证据
```
$ node scripts/e2e-mvp/run.mjs
总计 26 项，通过 26，失败 0
✅ 端到端验收全部通过
```
