---
status: completed
execution_status: completed
task_id: T258
plan_ref: SEC-02
stage: M1
priority: P0
model_tier: 强
branch: feature/T258-sec-02
start_time: 2026-10-23
complete_time: 2026-10-24
merge_commit: 7b923f9
blocked_by:
depends_on: T252
acceptance_evidence: tasks/evidence/T258.md
handoff: docs/handoff/2026-10-23-T258-JWT与会话强化.md
---

# T258：JWT 与会话强化（SEC-02）

## 背景

`docs/19` SEC-02 覆盖三个仍成立的问题：

- **ISS-09**：`JwtStrategy` 使用 `configService.get('jwt.secret') || 'fallback-secret'`。虽然 `jwt.config.ts` 会先抛错，但守卫层保留了公开已知的兜底密钥，属于 fail-open 写法。
- **ISS-26**：登出时传入无效/过期 Refresh Token 会抛 `UnauthorizedException`，客户端拿到 401/500，且无法保证幂等。
- **ISS-49**：TENANT 每次鉴权要查 `user` 再查 `tenant`，两次 Prisma 调用。

此外 JWT 未显式限定算法，过期时间配置格式错误要等到签发时才暴露，Refresh Cookie 的 `maxAge` 固定 7 天、可能与 `JWT_REFRESH_EXPIRY` 不一致。

## 范围

- 密钥 fail-closed：`JwtStrategy` 改用 `getOrThrow('jwt.secret')`，删除 `fallback-secret`；`env.validation` 在生产/预发拒绝短于 32 字节的 `JWT_SECRET`（开发/测试仅警告）。
- 算法固定 HS256：`JwtAuthService` 的签发与校验、`JwtStrategy` 均显式声明 `HS256`，拒绝 `alg=none` / 算法混淆。
- 登出幂等：`revokeRefreshToken()` 对解析失败、非 Refresh Token、未知 jti 直接返回；存储层异常仍抛出。
- 鉴权查询合并：`JwtStrategy` 用一次 `user.findUnique` 通过 `tenant: { select: { id } }` 取回租客档案，不再单独 `tenant.findUnique`；TENANT 无档案仍 401。
- 配置格式校验：`jwt.config.ts` 启动时校验 `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` 必须是「正整数 + 单位」，拒绝纯数字（避免被 jsonwebtoken 当作毫秒）。
- Cookie 对齐：`auth-cookie.util` 接受 `maxAgeMs`，控制器从 `JWT_REFRESH_EXPIRY` 解析后传入，Cookie 与 Refresh Token 同步过期。
- 新增 `common/utils/duration.ts` 及测试；补充 JwtStrategy、jwt.service、cookie、env.validation、jwt.config 测试。

## 非目标

- Refresh Token 原子轮换与重放检测（T208 已完成，保持不动）。
- OTP、登录锁定、密码策略（归 SEC-03 / SEC-05）。
- 注册与身份绑定（SEC-04）。
- Access Token 主动撤销列表：15 分钟短有效期 + 每次请求回查用户状态已覆盖降权/禁用。
- 开启 Prisma `relationJoins` 预览特性把关系查询压成单条 SQL：影响面大，留待性能专项评估。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 缺少 `jwt.secret` 时启动失败，不再回退公开密钥 | `jwt.config.spec.ts`、`jwt.strategy` 构造使用 `getOrThrow` |
| 2 | 生产/预发拒绝 <32 字节 `JWT_SECRET`；开发仅警告 | `env.validation.spec.ts` |
| 3 | 签发/校验只接受 HS256 | `jwt.service.spec.ts` 生成与验签通过；算法显式配置 |
| 4 | 登出对无效/过期/Access Token 幂等，返回 200 且不误撤销会话 | `jwt.service.spec.ts` 新增用例 |
| 5 | TENANT 鉴权只调用一次 `user.findUnique`，无档案仍 401 | `jwt.strategy.spec.ts` |
| 6 | 非法过期格式启动即失败；Cookie `maxAge` 与配置一致 | `jwt.config.spec.ts`、`auth-cookie.util.spec.ts` |
| 7 | 全量测试、lint、tsc 通过 | 见验收证据 |

## 文件归属

- `backend/src/common/utils/duration.ts`、`duration.spec.ts`（新增）
- `backend/src/config/jwt.config.ts`、`jwt.config.spec.ts`（新增）、`env.validation.ts`、`env.validation.spec.ts`
- `backend/src/modules/auth/jwt.service.ts`、`jwt.service.spec.ts`
- `backend/src/modules/auth/strategies/jwt.strategy.ts`、`jwt.strategy.spec.ts`
- `backend/src/modules/auth/auth-cookie.util.ts`、`auth-cookie.util.spec.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `docs/05-接口规范.md`、`docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T258-sec-02`
- 工作树：`/home/user/development/worktrees/tenant-management-system/T258-sec-02`
- 基线：`84cb471`（`origin/develop`，含 T257 回填）
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-23
- 完成日期：2026-10-24
- 合并：PR #64，merge commit `7b923f9`
- 状态：completed

## 风险

- 生产环境若使用短于 32 字节的 `JWT_SECRET`，升级后会拒绝启动；这是有意的 fail-closed，需在发布前轮换密钥。
- 禁止纯数字过期格式属于破坏性配置校验；默认值 `15m` / `7d` 不受影响，`.env.example` 与 docs/12 已注明。
- 单次 Prisma 关系查询在默认 `query` 策略下仍可能发两条 SQL；本任务减少的是应用层调用与连接占用，真正的单 SQL 需评估 `relationJoins`。
- 已有令牌继续有效，算法固定为 HS256 与现有签发一致，无需强制重新登录。
