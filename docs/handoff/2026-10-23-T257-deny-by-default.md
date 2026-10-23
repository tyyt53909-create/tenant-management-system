---
status: active
owner_tier: strong
applies_to:
  - backend/src/common/guards/**
  - backend/src/common/decorators/public.decorator.ts
  - backend/src/app.module.ts
  - backend/test/route-policy.snapshot.json
last_verified: 2026-10-23
verified_commit: 0bae3be
supersedes: null
superseded_by: null
version: 1.0
---

# 交接记录：T257 全域 deny-by-default 授权

---
日期: 2026-10-23
任务: T257-SEC-01-deny-by-default
对话ID: session-t257
模型: DeepSeek V4.1 Flash
状态: in_progress（实现与本地验证完成，待 PR / 合并）
---

## 完成内容

### 授权模型
- ✅ 新增 `@Public()`（`IS_PUBLIC_KEY`），公开面必须显式声明。
- ✅ `JwtAuthGuard` 注入 `Reflector`：类/方法公开则跳过 passport，否则校验 JWT。
- ✅ `AppModule` 以 `APP_GUARD` 全局注册 `JwtAuthGuard`、`RolesGuard`，顺序 限流 → JWT → 角色。
- ✅ 现有公开面全部标注：根路由、健康检查、公开看房、认证 8 个入口。
- ✅ 控制器上遗留的 `@UseGuards(JwtAuthGuard, RolesGuard)` 保留为纵深防御。

### 路由策略快照
- ✅ `route-policy.spec.ts` 静态解析全部控制器，导出 141 条路由的 `method / path / public / roles`。
- ✅ `backend/test/route-policy.snapshot.json` 锁定策略；变更需 `UPDATE_ROUTE_SNAPSHOT=1` 显式刷新。
- ✅ 公开路由白名单 16 条，新增公开接口必须同时改白名单与快照。
- ✅ 公开路由不得声明 `@Roles()`。

### 测试
- ✅ 新增 3 组用例（守卫分支、路由快照、默认拒绝 e2e），共 14 例。
- ✅ 后端 95 文件 / 946 用例、e2e 3 文件 / 63 用例通过；lint / tsc 通过。

### 文档
- ✅ `docs/03-权限矩阵.md` 新增 §5.4；`docs/19` T257 置为 active；`docs/INDEX.md` 登记任务书与交接记录。

## 升级注意事项

- 漏标 `@Public()` 的公开控制器会在上线后返回 401；本次已覆盖全部现有控制器，新增控制器必须显式选择公开或登录。
- JWT 校验仍在每个调用点重复执行（全局 + 控制器遗留守卫），行为正确但有重复开销；清理归后续优化，不在本轮。
- 快照是静态 AST 解析，不覆盖动态路由；当前项目无动态路由。

## 遗留问题

1. **角色粒度补齐**
   - 优先级：中
   - 说明：默认拒绝只保证「必须登录」；部分路由仍无 `@Roles()`，按 docs/03 矩阵逐步补齐。
2. **重复守卫清理**
   - 优先级：低
   - 说明：可在确认全局守卫稳定后移除控制器级 `JwtAuthGuard` 绑定。
3. **SEC-02 / SEC-03 / SEC-04 衔接**
   - 优先级：高
   - 说明：JWT 强化、OTP 防护、身份绑定均以本任务的默认拒绝为基线。

## 下一步

- 创建 PR 到 `develop`，CI 绿后等待人工授权合并。
- 合并后回填 `merge_commit`、任务书/handoff 置 completed，并重新生成 STATUS。
- 下一个无依赖 M1 任务：T258（SEC-02 JWT 与会话强化）。

## 附加信息

### 提交记录
- 分支：`feature/T257-sec-01`
- 工作树：`/home/user/development/worktrees/tenant-management-system/T257-sec-01`
- PR：待创建

### 资源
- 任务书：`tasks/T257-SEC-01-deny-by-default授权.md`
- 验收证据：`tasks/evidence/T257.md`
- 规范：`docs/03-权限矩阵.md` §5.4、`docs/19-生产化路线图.md` SEC-01

---

**交接给**: T258（SEC-02）负责模型
**确认人**: @human-owner
