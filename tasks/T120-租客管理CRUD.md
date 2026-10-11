---
status: completed
task_id: T120
stage: 阶段1
priority: P0
model_tier: 普通
estimated_hours: 3
actual_hours: 1
branch: feature/T120-tenants-crud
worktree: /Users/Admin/ai/租客管理系統-worktrees/T120-tenants-crud
model: Claude Opus 5.5
start_time: 2026-10-11
complete_time: 2026-10-11
pr: pending
---

# T120: 租客管理 CRUD

## 任务信息

- **任务编号**: T120
- **所属阶段**: 阶段1 - 核心地基与样板模块
- **优先级**: P0
- **建议模型档位**: 普通
- **预计工时**: 3小时
- **前置依赖**: T116-T119（房源管理，样板模块）
- **阻塞任务**: 合同管理

---

## 任务目标

照房源模块样板实现租客管理的完整 CRUD 功能。

---

## 任务范围

### 必须完成

1. **TenantsModule**
   - TenantsController（REST API）
   - TenantsService（业务逻辑）
   - DTOs（Create, Update, Response, Query）
   - Module 注册

2. **CRUD 接口**
   - POST /tenants - 创建租客（管理员）
   - GET /tenants - 租客列表（分页、筛选）
   - GET /tenants/:id - 租客详情
   - PATCH /tenants/:id - 更新租客（管理员）
   - DELETE /tenants/:id - 删除租客（管理员）

3. **业务逻辑**
   - 手机号唯一性检查
   - 邮箱唯一性检查（可选）
   - 硬删除

4. **权限控制**
   - 使用 RolesGuard + @Roles 装饰器
   - 管理员可 CRUD，租客只能查看

5. **测试**
   - TenantsService 单元测试
   - TenantsController 单元测试

---

## Prisma Schema 字段

```prisma
model Tenant {
  id               String    @id @default(cuid())
  name             String    // 姓名（必填）
  phone            String    @unique // 手机号（必填，唯一）
  email            String?   @unique // 邮箱（可选，唯一）
  
  emergencyContact String?   // 紧急联系人
  emergencyPhone   String?   // 紧急联系电话
  
  tags             Json?     // 标签（JSON）
  notes            String?   // 备注
  
  isActive         Boolean   @default(true) // 是否激活
  userId           String?   @unique // 关联用户ID
  
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}
```

---

## 验收标准

1. ✅ TenantsModule 创建并注册到 AppModule
2. ✅ 5个 REST API 接口可用
3. ✅ 手机号唯一性检查
4. ✅ 邮箱唯一性检查（如果提供）
5. ✅ 权限控制（管理员 vs 租客）
6. ✅ 分页查询
7. ✅ 筛选查询（isActive）
8. ✅ DTO 自动验证
9. ✅ TenantsService 单元测试覆盖率 ≥90%
10. ✅ TenantsController 单元测试覆盖率 ≥90%
11. ✅ TypeScript 编译通过
12. ✅ Lint 检查通过

---

## 交付物

1. `src/modules/tenants/tenants.module.ts`
2. `src/modules/tenants/tenants.controller.ts`
3. `src/modules/tenants/tenants.service.ts`
4. `src/modules/tenants/dto/create-tenant.dto.ts`
5. `src/modules/tenants/dto/update-tenant.dto.ts`
6. `src/modules/tenants/dto/query-tenants.dto.ts`
7. `src/modules/tenants/dto/tenant-response.dto.ts`
8. `src/modules/tenants/tenants.service.spec.ts`
9. `src/modules/tenants/tenants.controller.spec.ts`

---
