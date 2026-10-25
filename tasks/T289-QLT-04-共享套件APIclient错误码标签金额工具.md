---
status: completed
execution_status: completed
task_id: T289
plan_ref: QLT-04
stage: M2
priority: P1
model_tier: 普通
branch: feature/T289-qlt-04-shared-kit
merge_commit: 51fd04d
start_time: 2026-10-25
completed_time: 2026-10-25
blocked_by:
depends_on: T256, T275, T285, T287
acceptance_evidence: tasks/evidence/T289.md
handoff: docs/handoff/2026-10-25-T289-三端共享套件.md
---

# T289：共享套件——API client、错误码、标签、金额工具（QLT-04）

## 背景

T275/T285/T287 完成后，金额、错误码、联系方式规范化等纯函数在前端后台与小程序各自维护：

- **金额**：`frontend-admin/src/utils/money.ts` 与 `miniprogram/utils/format.js` 各有一份「分↔元」实现；算法相同但测试各自覆盖，改一处漏一处（FIN-10 的「单一入口」只覆盖了后台）。
- **错误码**：后端 `backend/src/common/errors/error-codes.ts` 是唯一事实来源（镜像 docs/05 §5.2）；前端 `apiError.ts` 的 `CODE_MESSAGES`、小程序 `request.js` 的错误码判断均为手抄字符串，无任何机制拦截两端漂移。
- **联系方式规范化**：后端 `normalize-contact.ts`（T260 引入）前端完全缺失；小程序提交的邮箱大小写与后端规范化规则靠约定一致。

三处重复均为纯函数（无框架依赖），适合收敛进单一共享包，让 CI 验证「三端同一实现」。

## 范围

### 1. 新建共享包 `shared/`（仓库根目录）

- 纯 TypeScript + 纯函数，**零运行时依赖**（不 import @nestjs/*、vue、uni-app）。
- 目录：`shared/src/{error-codes.ts, money.ts, contact.ts, api-error.ts}`，`shared/package.json`（`"type": "module"`），`shared/tsconfig.json`。
- 构建产物策略：**源码直引**（三端 tsconfig/vitest 直接引用 `../shared/src/*.ts`），不引入构建步骤与发布流程；产物目录 `shared/dist` 不创建。
- 各文件带 `*.spec.ts`，由 backend 的 vitest 统一跑（`include` 增加 `../shared/src/**/*.spec.ts`），复用现有 CI 闸门，不新增 workflow。

### 2. 错误码目录迁移（唯一事实来源倒转）

- `shared/src/error-codes.ts`：`ERROR_CATALOG`（code → status 数值 + description）从后端迁入；status 改用数值常量（共享包不得依赖 @nestjs/common）。
- `backend/src/common/errors/error-codes.ts` 改为 re-export，并在原有 `HttpStatus` 映射层（保留 NestJS 抛错便利方法）适配；`error-codes.spec.ts` 继续校验与 docs/05 §5.2 双向一致——docs/05 仍是文档侧事实来源。
- `frontend-admin/src/utils/apiError.ts` 的 `CODE_MESSAGES` 改为从共享包 import code 常量；展示文案保留在前端（文案属于 UI 层），但 key 必须引用共享常量，杜绝手抄字符串。

### 3. 金额工具迁移

- `shared/src/money.ts`：`yuanToCents`/`centsToYuan`/`formatMoneyPlain`/`formatMoney`/`formatSignedMoney` 与现有 spec 从 frontend-admin 迁入。
- `frontend-admin/src/utils/money.ts` 改为 re-export（保持既有 import 路径不破坏）。
- 小程序：`miniprogram/utils/format.js` 的 `money()` 改为引用共享实现。小程序是 JS + uni-app 构建链，若源码直引 TS 有困难，允许在 `miniprogram/scripts/` 增加「从 shared 生成 `money.generated.js`」的生成脚本（生成物提交入库，CI 校验 `--check` 模式防漂移），优先尝试直接 import，失败再退回生成方案。
- 后端 `backend/src/common/utils/money.util.ts` 若与共享实现重复，收敛为 re-export；差异部分（如 Decimal 处理）保留在后端。

### 4. 联系方式规范化共享

- `shared/src/contact.ts`：迁入 `normalizeEmail`/`normalizePhone` 及 spec。
- 后端 `normalize-contact.ts` 改 re-export。
- 小程序登录/绑定邮箱处调用共享规范化后再提交（若走生成方案则同样生成）。

### 5. API client（仅整理，不重写）

- 小程序 `miniprogram/utils/request.js` 已在 T287 类型化，本任务**只**把其中的错误码字符串判断改为引用共享错误码常量；不做请求层重构。
- frontend-admin 的 `request.ts`/`apiError.ts` 在 T285 已统一，本任务只接错误码常量。
- 不新建独立 npm 包、不发布 npm、不引入 monorepo 工具。

## 非目标

- 请求层行为变更（重试、刷新令牌、轮询逻辑均不动）。
- 错误文案从代码抽离到 i18n。
- `shared/dist` 产物与 npm 发布。
- 新错误码或错误码语义变更（只做搬家，不改 docs/05）。
- 标签（TenantTag）相关逻辑——路线图描述中的「标签工具」经核对无三端重复实现，不纳入。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 金额、错误码、联系方式规范化三端（backend/frontend-admin/miniprogram）引用同一实现，grep 无第二份重复算法 | `grep` 抽查 + code review |
| 2 | 后端 `error-codes.spec.ts` 双向校验 docs/05 §5.2 仍通过（文档侧不变） | `npm test` |
| 3 | frontend-admin 既有测试不改断言即通过（re-export 兼容） | `npm --prefix frontend-admin test` |
| 4 | 小程序测试通过；若走生成方案，CI 校验生成物未漂移 | `npm --prefix miniprogram test` |
| 5 | 全量后端测试、tsc、lint、e2e、docs-check 通过 | `tasks/evidence/T289.md` |
| 6 | 共享包自身 spec 在 CI 中被执行 | vitest 配置与 CI 日志 |

## 文件归属

- `shared/**`（新增）
- `backend/src/common/errors/error-codes.ts`、`error-codes.spec.ts`（适配）
- `backend/src/common/utils/money.util.ts`、`normalize-contact.ts`（re-export）
- `backend/vitest.config.ts`（include shared spec）
- `frontend-admin/src/utils/apiError.ts`、`money.ts`（re-export/引用）
- `miniprogram/utils/format.js`、`request.js`、`scripts/`（生成脚本，若走生成方案）
- `docs/05-接口规范.md`（仅当需要说明共享包位置时微调；错误码表本身不改）
- `docs/INDEX.md`、`STATUS.md`、`tasks/evidence/T289.md`

## 风险

- 小程序 TS 源码直引可能受 uni-app 构建链限制；已备生成脚本方案，两种都在验收标准 4 内。
- 错误码搬家后 `HttpStatus` 数值需与 NestJS 枚举逐一核对，`error-codes.spec.ts` 既有断言会拦截错误。
- re-export 不当会破坏既有 import 路径；验收标准 3 以「测试不改断言」把关。

## 开发信息

- 分支：`feature/T289-qlt-04-shared-kit`
- 基线：`071f08a`（PR #126 合并后 develop）
- 模型档位：普通
- 开始日期：2026-10-25
