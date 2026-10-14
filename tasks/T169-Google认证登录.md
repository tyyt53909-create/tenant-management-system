---
status: active
owner_tier: strong
applies_to:
  - backend/prisma/schema.prisma
  - backend/prisma/migrations/20261014131700_add_google_auth/**
  - backend/src/modules/auth/**
  - frontend-admin/src/views/login/index.vue
  - miniprogram/pages/login/login.vue
last_verified: 2026-10-14
verified_commit: HEAD
supersedes: null
superseded_by: null
version: 1.0
---

# T169: Google 统一认证与第三方登录

## 1. 任务背景
为了支持外籍租客、国际化公寓业务及多端无缝体验，系统在已有微信和账号密码体系之外，引入 Google OAuth 2.0 统一登录能力（Sign in with Google）。

## 2. 目标与范围
- **数据库扩展**：
  - `User` 模型扩充 `googleId`（唯一索引）、`avatarUrl`，并将 `passwordHash` 设为可空（第三方登录无初始密码）。
  - 执行并通过 Prisma 迁移 `20261014131700_add_google_auth`。
- **后端 Google 认证体系**：
  - `GoogleAuthService`：引入 `google-auth-library` 验证官方 ID Token，同时支持本地/测试环境 `mock-google-token:` 模式，便于离线与 CI 自动化测试。
  - `GET /api/auth/google/client-id`：动态暴露 Client ID，避免前端硬编码。
  - `POST /api/auth/google`：
    - 已有用户（按 Google ID 或邮箱精准命中）自动登入并补充绑定 Google ID 与大头像。
    - 新用户如提供有效邀请码，自动创建 User 与 Tenant 档案并失效邀请码；未提供邀请码时友善拦截并提示。
    - 统一签发系统 JWT Access Token 与 Refresh Token。
- **管理后台 (Admin Web)**：
  - `frontend-admin/src/views/login/index.vue` 增加 Google 登录区域。
  - 动态集成 Google GIS SDK，并在未配置 Client ID 时提供开发者测试通道弹窗。
- **手机租客端 (Miniprogram H5)**：
  - `miniprogram/pages/login/login.vue` 增加 Google Sign-In 按钮与原生 SVG 图标。
  - 支持一键快捷识别已预建租客，或在首次登录时通过邀请码完成房源绑定。

## 3. 验收标准
- [x] 后端 `prisma migrate deploy` 与 `prisma generate` 成功，表结构与类型同步。
- [x] 后端 GoogleAuthService、AuthController Google 登录与 Client ID 获取单元测试 100% 通过（新增 8 项测试用例）。
- [x] 小程序与前端后台 Google 登录接口调用测试 100% 通过。
- [x] 管理后台与租客端 H5 均提供 Google 登录入口与状态反馈。
