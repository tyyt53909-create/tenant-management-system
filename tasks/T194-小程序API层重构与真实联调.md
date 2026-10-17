---
status: completed
task_id: T194
stage: 优化计划 M3 / OPT-21
priority: P2
model_tier: 强
estimated_hours: 14
branch: feature/T194-miniprogram-api-refactor
start_time: 2026-10-17 00:05:00
complete_time: 2026-10-17 00:20:00
handoff: docs/handoff/2026-10-17-T194-小程序API层重构与真实联调.md
---

# T194: 小程序 API 层重构与真实联调（OPT-21）

依据优化计划 OPT-21。分支从 `feature/T193-admin-token-storage` 拉出。

## 目标

1. **API 模块按领域拆分**：
   - 将原单文件 `miniprogram/api/index.js` 按业务领域拆分：
     - `auth.js`：密码/验证码/Google 登录、邀请码绑定、用户信息
     - `contracts.js`：我的合同
     - `bills.js`：我的账单、账单详情
     - `maintenance.js`：报修记录、详情、报修创建、图片上传
     - `prepay.js`：预付账户余额、充值记录
     - `cleaning.js`：保洁房源列表、开始保洁、完成保洁
     - `notifications.js`：消息列表、未读计数、已读标记、删除消息
   - 保持 `api/index.js` 统一聚合并全量导出，确保已有视图与测试 100% 兼容。
2. **JSDoc 类型规范**：
   - 在各领域 API 文件中引入 JSDoc 注解（包含参数结构与返回 Promise 类型），提供完备的编辑器代码补全与静态提示。
3. **统一错误码与弱网处理**：
   - 在 `miniprogram/utils/request.js` 中接入统一错误码映射（如 `AUTH_INVALID_CREDENTIALS`、`PERM_FORBIDDEN`、`ROOM_VERSION_CONFLICT`、`PREPAY_INSUFFICIENT_BALANCE` 等）。
   - 网络断网或超时失败时提供明确友好提示（`网络连接失败，请检查网络设置`），杜绝异常导致的脚本崩溃或无反馈。
4. **全链路端到端验证**：
   - 编写与补充针对 API 领域层与主流程的自动化测试套件。
   - 验证租客主链路（登录 → 看合同 → 看账单 → 提报修 → 看通知）与保洁主链路（开始保洁 → 完成保洁）。

## 验收标准

- [x] `miniprogram/api/` 按领域拆分为 7 个模块，各模块配备完整 JSDoc 注解
- [x] `miniprogram/api/index.js` 统一聚合导出，100% 向后兼容
- [x] 统一错误码与弱网异常处理，网络故障时提示明确（断网/超时友好弹窗提示）
- [x] 小程序与全系统自动化测试全绿（小程序 108 测试全绿，mp-weixin 构建与工件校验通过）
