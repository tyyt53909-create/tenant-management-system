---
status: active
execution_status: active
task_id: T293
plan_ref: PAY-01
stage: M3
priority: P1
model_tier: 强
branch: feature/T293-wechat-pay
start_time: 2026-10-25
blocked_by:
depends_on: DEC-04, WX-01, FIN-03, FIN-05, OPS-05
acceptance_evidence: tasks/evidence/T293.md
---

# T293：微信支付 JSAPI 收款（PAY-01）

## 背景与目标

根据生产化路线图（docs/19 §4/§5 里程碑 M3）与架构决策 DEC-04（微信支付直连商户号，手续费业主承担），为租客端小程序提供在线微信缴费（租金、水电、押金等各类账单）核心能力。

本任务依托 T290（WX-01 微信身份体系与 openid）、T264（FIN-05 收款正确性与幂等入账机制）及 T267（FIN-03 押金台账联动）：
1. **统一支付通道抽象扩展（`PaymentProvider`）**：
   - 扩充统一支付服务接口 `PaymentProvider`，提供预支付下单（`createJsapiOrder`）、订单查询（`queryOrder`）、异步回调通知验签与密文解密（`parseNotify`）契约。
   - 实现 `WechatPaymentProvider`：严格遵守微信支付 API v3 规范，支持商户私钥 RSA-SHA256 请求签名、平台证书/公钥验签与 AEAD_AES_256_GCM 回调解密。
   - 实现 `MockPaymentProvider`：支持在 `WECHAT_PAY_MOCK=true` 或本地/CI 缺少真实商户秘钥时自洽模拟下单与回调生成，保障 CI 自动化与真实 PostgreSQL 测试 100% 可行。
2. **租客调起支付与鉴权**：
   - 暴露 `POST /api/bills/:id/pay/wechat-jsapi`：
     - 校验当前登录用户为该账单所属租客（防越权）；
     - 校验账单待缴状态与可缴金额，自动从 `UserIdentity(provider = WECHAT_MP)` 提取租客 openid；
     - 调用支付服务生成微信预支付单，并计算客户端调用 `wx.requestPayment` 所需的安全签名参数（`appId`、`timeStamp`、`nonceStr`、`package`、`signType`、`paySign`）。
3. **微信支付回调与幂等入账**：
   - 暴露 `POST /api/payments/wechat/notify`（公开路由 `@Public()`）：
     - 严格校验微信支付平台验签头部（`Wechatpay-Signature`、`Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Serial`），解析并解密 `resource.ciphertext`；
     - 驱动财务交易安全入账：复用 `BillPaymentService.addPayment` 严格执行行级悲观锁、全局唯一幂等键（`idempotencyKey = wechat_notify_{transaction_id}`）、收据序列号原子分配与押金台账联动（FIN-03）；
     - 返回微信支付要求的统一响应格式 `{ code: 'SUCCESS', message: '成功' }`。
4. **主动查单兜底机制**：
   - 暴露 `POST /api/bills/:id/pay/wechat-query`：支持前端调起支付完成后或回调网络异常时，主动向微信端查询支付状态并驱动补单入账。
5. **客户端接入与测试保障**：
   - 小程序端 `miniprogram/api/bills.js` 导出 JSAPI 下单与查单接口。
   - 包含完整的单元测试、覆盖率、OpenAPI 契约检查及真实 PostgreSQL 集成测试。

## 验收标准

- [x] 实现 `WechatPaymentProvider` 与 `MockPaymentProvider`，支持 API v3 签名、验签、AES-GCM 解密与模拟模式。
- [x] 暴露 `POST /api/bills/:id/pay/wechat-jsapi`，校验租客权限并返回合法的小程序支付调起参数。
- [x] 暴露公开回调接口 `POST /api/payments/wechat/notify`，成功验签解密并幂等记账，同单重复回调不重复入账。
- [x] 暴露主动查单补账端点 `POST /api/bills/:id/pay/wechat-query`。
- [x] 环境变量 `WECHAT_PAY_*` 在 schema、env.example 与部署文档中登记并一致。
- [x] 小程序端封装支付 API 并通过测试。
- [x] 真实 PostgreSQL 数据库测试覆盖 JSAPI 下单、微信回调入账、幂等防重与主动查单。
