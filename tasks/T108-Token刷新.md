---
status: in_progress
task_id: T108
stage: 阶段1
priority: P0
model_tier: 普通
estimated_hours: 1
branch: feature/T108-token-refresh
worktree: /Users/Admin/ai/租客管理系統-worktrees/T108-token-refresh
model: Claude Opus 5.5
start_time: 2026-10-11
---

# T108: Token 刷新接口

## 任务信息

- **任务编号**: T108
- **所属阶段**: 阶段1 - 核心地基与样板模块
- **优先级**: P0
- **建议模型档位**: 普通
- **预计工时**: 1小时
- **前置依赖**: T104（JWT认证服务）, T107（用户登录接口）
- **阻塞任务**: 无（认证链最后一环）

---

## 任务目标

实现 Token 刷新接口，验证 Refresh Token，生成新的 Access Token，实现前端无感刷新。

---

## 任务范围

### 必须完成
1. POST /auth/refresh Token 刷新接口
2. 验证 Refresh Token
3. 生成新的 Access Token
4. RefreshTokenDto 定义
5. 单元测试

### 刷新流程
1. 接收 Refresh Token
2. 验证 Token（JwtAuthService.verifyToken）
3. 查询用户是否存在且激活
4. 生成新的 Access Token
5. 返回新 Token

---

## 验收标准

1. ✅ POST /auth/refresh 接口可用
2. ✅ 验证 Refresh Token
3. ✅ 生成新的 Access Token
4. ✅ 无效 Token 返回 401
5. ✅ 用户不存在返回 401
6. ✅ 用户未激活返回 403
7. ✅ 单元测试覆盖率 ≥90%
8. ✅ TypeScript 编译通过
9. ✅ Lint 检查通过

---

## 交付物

1. `src/modules/auth/dto/refresh-token.dto.ts`
2. 更新的 `src/modules/auth/auth.controller.ts`（添加 refresh 方法）
3. 更新的 `src/modules/auth/auth.controller.spec.ts`（添加 refresh 测试）

---
