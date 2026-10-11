# AGENTS.md - AI 协作开发总规则

> 本文档是所有 AI 模型的必读文档
> 版本: 1.0
> 最后更新: 2026-10-11

---

## 📋 文档定位

本文档是**所有 AI 模型参与开发的总规则**，包括：
- 技术栈与工具链
- 项目目录结构与命名规范
- Git 工作流与分支策略
- 文档治理规则
- 开发流程与工作流
- 安全红线与禁止事项

**任何新对话开始前必须先阅读本文档（约 10 分钟）。**

---

## 1. 技术栈

### 1.1 后端

| 技术 | 版本 | 说明 |
|------|------|------|
| **Node.js** | 20.x | LTS 版本 |
| **TypeScript** | 5.x | 严格模式 |
| **NestJS** | 10.x | 后端框架 |
| **Prisma** | 5.x | ORM，类型安全查询 |
| **PostgreSQL** | 16 | 数据库 |
| **Redis** | 6+ | 会话和缓存 |
| **Jest** | 29.x | 测试框架 |

### 1.2 前端

| 技术 | 版本 | 说明 |
|------|------|------|
| **Vue 3** | 3.x | 网页后台 + 小程序 |
| **TypeScript** | 5.x | 前端类型安全 |
| **uni-app** | 3.x | 小程序框架 |
| **Element Plus** | 2.x | 后台组件库（建议） |
| **Vite** | 5.x | 构建工具 |

### 1.3 基础设施

| 服务 | 说明 |
|------|------|
| **阿里云 OSS** | 对象存储（图片、附件） |
| **阿里云 RDS** | PostgreSQL 托管服务 |
| **GitHub Actions** | CI/CD |
| **Docker** | 本地开发环境 |

---

## 2. 项目目录结构

```
tenant-system/
├── .github/                    # GitHub 配置
│   ├── workflows/              # CI/CD 工作流
│   │   ├── docs-check.yml      # 文档检查
│   │   └── security-scan.yml   # 密钥扫描
│   ├── CODEOWNERS              # 代码所有者
│   └── pull_request_template.md # PR 模板
│
├── docs/                       # 📚 文档目录
│   ├── INDEX.md                # 文档索引（唯一注册表）
│   ├── 00-项目计划书.md
│   ├── 01-架构设计.md
│   ├── 02-数据模型.md
│   ├── 03-权限矩阵.md
│   ├── 04-状态机.md
│   ├── 05-接口规范.md
│   ├── 06-安全与合规清单.md
│   ├── 07-测试策略.md
│   ├── 09-待确认清单.md
│   ├── adr/                    # 架构决策记录
│   │   ├── 001-xxx.md
│   │   └── 002-xxx.md
│   ├── tasks/                  # 任务书
│   │   ├── T001-xxx.md
│   │   └── T002-xxx.md
│   ├── handoff/                # 交接记录
│   │   ├── 2026-10-12-T001-xxx.md
│   │   └── 2026-10-13-T002-xxx.md
│   └── archive/                # 已归档文档
│
├── prisma/                     # 数据库
│   ├── schema.prisma           # Prisma schema
│   ├── migrations/             # 迁移文件
│   └── seed.ts                 # 初始化数据
│
├── src/                        # 后端源码
│   ├── main.ts                 # 入口文件
│   ├── app.module.ts           # 根模块
│   ├── config/                 # 配置
│   │   ├── database.config.ts
│   │   └── app.config.ts
│   ├── common/                 # 公共模块
│   │   ├── decorators/
│   │   ├── guards/             # 守卫（权限控制）
│   │   ├── interceptors/       # 拦截器（日志、转换）
│   │   ├── filters/            # 异常过滤器
│   │   └── utils/
│   └── modules/                # 业务模块
│       ├── auth/               # 认证模块
│       ├── rooms/              # 房源模块（样板）
│       ├── tenants/            # 租客模块
│       ├── contracts/          # 合同模块
│       ├── billing/            # 账单模块
│       ├── prepay/             # 预付账户模块
│       ├── meters/             # 水电读数模块
│       ├── maintenance/        # 报修模块
│       ├── checkout/           # 退租模块
│       └── notifications/      # 通知模块
│
├── frontend-admin/             # 网页后台（独立项目）
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
│
├── miniprogram/                # 微信小程序（uni-app）
│   ├── src/
│   ├── package.json
│   └── manifest.json
│
├── scripts/                    # 脚本
│   ├── check-docs.js           # 文档检查脚本
│   └── update-index.js         # 更新 INDEX.md
│
├── .env.example                # 环境变量示例
├── .gitignore
├── package.json
├── tsconfig.json
├── docker-compose.yml          # 本地开发环境
├── AGENTS.md                   # 本文档
└── STATUS.md                   # 项目状态跟踪
```

---

## 3. 命名规范

### 3.1 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| **模块目录** | 复数小写，短横线分隔 | `rooms/`, `maintenance-requests/` |
| **DTO** | 大驼峰 + .dto.ts | `CreateRoomDto`, `UpdateRoomDto` |
| **Entity** | 大驼峰 + .entity.ts | `Room.entity.ts` |
| **Service** | 大驼峰 + .service.ts | `RoomsService` |
| **Controller** | 大驼峰 + .controller.ts | `RoomsController` |
| **Module** | 大驼峰 + .module.ts | `RoomsModule` |
| **测试** | 原文件名 + .spec.ts 或 .e2e.spec.ts | `rooms.service.spec.ts` |

### 3.2 代码命名

| 类型 | 规范 | 示例 |
|------|------|------|
| **变量** | 小驼峰 | `userName`, `roomList` |
| **函数** | 小驼峰，动词开头 | `createRoom()`, `findAllRooms()` |
| **类** | 大驼峰 | `RoomsService`, `BuildingGuard` |
| **接口** | 大驼峰，I 前缀（可选） | `IUser`, `CreateRoomDto` |
| **枚举** | 大驼峰 | `RoomStatus`, `UserRole` |
| **枚举值** | 大写下划线 | `ROOM_STATUS.VACANT` |
| **常量** | 大写下划线 | `MAX_FILE_SIZE`, `DEFAULT_PAGE_SIZE` |

### 3.3 数据库命名

| 类型 | 规范 | 示例 |
|------|------|------|
| **表名** | 复数小写下划线 | `rooms`, `maintenance_requests` |
| **字段名** | 小驼峰（Prisma）| `roomNumber`, `createdAt` |
| **索引** | `idx_{表名}_{字段}` | `idx_rooms_status` |
| **外键** | `fk_{表名}_{字段}` | `fk_rooms_building_id` |

---

## 4. Git 工作流

### 4.1 分支策略

```
main (受保护)
  ├── develop (受保护)
  │   ├── feature/T001-scaffold      # 功能分支
  │   ├── feature/T002-auth          # 功能分支
  │   └── fix/T010-billing-bug       # 修复分支
  └── hotfix/urgent-security-patch   # 紧急修复
```

**分支命名规范**：
- `feature/T{编号}-{简述}` - 功能开发
- `fix/T{编号}-{简述}` - Bug 修复
- `hotfix/{简述}` - 紧急修复（直接从 main 分出）
- `docs/{简述}` - 纯文档变更

### 4.2 Git Worktree 使用

#### 为什么使用 Worktree？
- ✅ 每个任务独立工作目录，避免分支切换冲突
- ✅ 多个任务可并行开发（不同模型/对话）
- ✅ 不影响主仓库，易于清理

#### 目录结构

```
~/projects/
├── tenant-system/              # 主仓库
│   ├── .git/                   # Git 元数据
│   ├── docs/
│   ├── src/
│   └── ...
└── tenant-system-worktrees/    # 工作树目录（与主仓库同级）
    ├── T001-scaffold/          # 任务 T001 的工作树
    ├── T002-auth/              # 任务 T002 的工作树
    └── T003-rooms/             # 任务 T003 的工作树
```

#### 创建 Worktree

```bash
# 1. 进入主仓库
cd ~/projects/tenant-system

# 2. 创建新分支和工作树
git worktree add ../tenant-system-worktrees/T001-scaffold -b feature/T001-scaffold

# 说明:
# - ../tenant-system-worktrees/T001-scaffold: 工作树路径（任务编号命名）
# - -b feature/T001-scaffold: 创建新分支
# - 如果分支已存在，省略 -b 参数

# 3. 进入工作树
cd ../tenant-system-worktrees/T001-scaffold

# 4. 在任务书中登记（必须）
cat >> docs/tasks/T001-脚手架搭建.md << EOF

## 开发信息
- 分支: feature/T001-scaffold
- 工作树: ~/projects/tenant-system-worktrees/T001-scaffold
- 模型: Claude Opus 5.5
- 开始时间: $(date +"%Y-%m-%d %H:%M:%S")
- 状态: in_progress
EOF

# 5. 提交任务登记
git add docs/tasks/T001-脚手架搭建.md
git commit -m "docs(task): 登记 T001 任务开发信息"
```

#### 切换 Worktree

```bash
# 直接 cd 到对应工作树目录
cd ~/projects/tenant-system-worktrees/T002-auth

# 或使用别名（可写入 ~/.bashrc 或 ~/.zshrc）
alias goto-task='cd ~/projects/tenant-system-worktrees/$1'
goto-task T002-auth
```

#### 清理 Worktree

```bash
# 任务完成并合并后

# 1. 回到主仓库
cd ~/projects/tenant-system

# 2. 删除工作树
git worktree remove ../tenant-system-worktrees/T001-scaffold

# 或强制删除（如有未提交改动）
git worktree remove --force ../tenant-system-worktrees/T001-scaffold

# 3. 删除远程分支（PR 合并后自动删除，本地也需删除）
git branch -d feature/T001-scaffold

# 4. 在任务书中标记完成
cat >> docs/tasks/T001-脚手架搭建.md << EOF

- 完成时间: $(date +"%Y-%m-%d %H:%M:%S")
- 状态: completed
- 合并PR: #1
EOF
```

#### 查看所有 Worktree

```bash
git worktree list

# 输出示例:
# /Users/user/projects/tenant-system              abc123 [main]
# /Users/user/projects/tenant-system-worktrees/T001-scaffold  def456 [feature/T001-scaffold]
# /Users/user/projects/tenant-system-worktrees/T002-auth      ghi789 [feature/T002-auth]
```

### 4.3 提交信息规范

```
<type>(<scope>): <subject>

<body>

Task: T{编号}
```

**Type**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 纯文档变更
- `refactor`: 重构（不改变功能）
- `test`: 测试相关
- `chore`: 构建/工具相关
- `style`: 代码格式（不影响逻辑）

**Scope**（可选）：模块名，如 `auth`, `billing`, `rooms`

**Subject**：简短描述（<50字符）

**Body**（可选）：详细说明

**示例**：
```
feat(auth): 实现邀请码验证逻辑

- 创建 InviteCode 实体
- 实现验证和失效逻辑
- 添加单元测试

Task: T002
```

### 4.4 保护分支规则

| 分支 | 保护规则 |
|------|----------|
| **main** | 只能通过 PR 合并、必须通过 CI、需 1 人批准 |
| **develop** | 只能通过 PR 合并、必须通过 CI |
| **feature/** | 无保护 |

---

## 5. 文档治理规则

### 5.1 文档元信息（必须）

每份文档头部必须包含：

```yaml
---
status: draft | active | superseded | archived
owner_tier: human | strong | medium | cheap
applies_to:
  - 代码路径（glob 模式）
last_verified: YYYY-MM-DD
verified_commit: abc1234（前7位）
supersedes: null
superseded_by: null
version: 1.0
---
```

### 5.2 文档注册（必须）

- 所有文档必须在 `docs/INDEX.md` 中登记
- 未登记文档视为无效
- CI 会检查是否登记

### 5.3 文档同步规则

| 文档类型 | 同步要求 |
|----------|----------|
| **事实来源类** | 代码变更时必须同步更新 |
| **决策类** | 只新增不修改，通过 supersedes 取代 |
| **过程类** | 只追加不修改，完成后归档 |

**事实来源类文档**：
- 数据模型、权限矩阵、状态机、接口规范、架构设计

**决策类文档**：
- ADR、安全与合规清单、测试策略

**过程类文档**：
- 项目计划书、任务书、交接记录、周报

### 5.4 文档不一致处理

如果发现文档与代码不一致：

```markdown
## ⚠️ 发现不一致

**文档**：docs/02-数据模型.md（last_verified: 2026-10-11）
**代码**：prisma/schema.prisma

**不一致点**：
- 文档描述 Room 表有 `version` 字段
- 实际代码中没有此字段

**操作**：
1. ❌ 不得自行猜测哪个是正确的
2. ✅ 记录到 docs/09-待确认清单.md
3. ✅ 在 PR 中 @human-owner 通知人工
4. ⏸️  暂停相关开发，等待确认
```

---

## 6. 开发流程

### 6.1 新对话启动清单

1. **阅读 AGENTS.md**（本文档，10分钟）
2. **阅读 docs/INDEX.md**（找到需要的文档，5分钟）
3. **只依据 status=active 的文档**
4. **检查 docs/09-待确认清单.md**
5. **阅读任务书** `docs/tasks/T{编号}.md`
6. **创建 Worktree**（如果是新任务）
7. **开始工作**

### 6.2 任务开发流程

```mermaid
graph TD
    A[接收任务] --> B[创建 Worktree]
    B --> C[创建分支]
    C --> D[登记任务书]
    D --> E[阅读相关文档]
    E --> F[编写代码]
    F --> G[编写测试]
    G --> H[本地验证]
    H --> I[更新文档]
    I --> J[提交代码]
    J --> K[创建交接记录]
    K --> L[创建 PR]
    L --> M[等待 CI]
    M --> N{CI 通过?}
    N -->|是| O[人工审核]
    N -->|否| F
    O --> P{审核通过?}
    P -->|是| Q[合并 PR]
    P -->|否| F
    Q --> R[删除 Worktree]
    R --> S[完成]
```

### 6.3 样板模块模式

**第一版开发**：
1. **强模型（Opus）**：完成核心架构和样板模块（房源模块）
2. **中等模型（Sonnet）**：照样板完成其他业务模块
3. **廉价模型（Haiku）**：完成 UI 页面和简单功能

**样板模块位置**：`src/modules/rooms/`

**样板模块包含**：
- 完整的 CRUD 接口
- DTO 验证
- 权限控制
- 状态管理
- 单元测试
- 集成测试
- OpenAPI 文档

**其他模块**：照样板实现，只改业务逻辑

---

## 7. 测试要求

### 7.1 测试覆盖率要求

| 模块类型 | 单元测试覆盖率 | 集成测试覆盖率 |
|----------|----------------|----------------|
| **核心业务** | ≥90% | ≥80% |
| **工具函数** | 100% | - |
| **其他模块** | ≥70% | ≥60% |

### 7.2 必须测试的场景

- 状态机所有合法和非法转换
- 权限控制（越权访问被拦截）
- 数据验证（边界条件）
- 幂等性（收款、退款等）
- 并发控制（房态修改冲突）

### 7.3 测试命令

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:e2e

# 生成覆盖率报告
npm run test:cov

# 监听模式（开发时）
npm run test:watch
```

---

## 8. 安全红线（禁止事项）

### 8.1 代码安全

| 禁止行为 | 说明 | 正确做法 |
|----------|------|----------|
| ❌ 硬编码密钥 | 密钥、密码写在代码里 | 使用环境变量 |
| ❌ 明文存储密码 | 密码不加密 | 使用 bcrypt |
| ❌ SQL 拼接 | 字符串拼接查询 | 使用 Prisma 参数化查询 |
| ❌ 不验证输入 | 直接使用用户输入 | 使用 class-validator |
| ❌ 返回敏感信息 | 列表返回证件号等 | 使用 DTO 脱敏 |

### 8.2 Git 安全

| 禁止行为 | 说明 | 正确做法 |
|----------|------|----------|
| ❌ 提交密钥 | .env 文件、私钥提交 | 添加到 .gitignore |
| ❌ 直接推送到 main | 跳过 PR 流程 | 通过 PR 合并 |
| ❌ 强制推送 | `git push --force` | 创建新提交 |
| ❌ 提交大文件 | 超过 100MB 的文件 | 使用 OSS |

### 8.3 文档安全

| 禁止行为 | 说明 | 正确做法 |
|----------|------|----------|
| ❌ 修改 owner_tier=human 的文档 | 人工维护文档 | 提交建议，等待人工修改 |
| ❌ 跳过 INDEX.md 登记 | 文档未登记就提交 | 先登记再提交 |
| ❌ 猜测文档与代码的差异 | 不确定谁是正确的 | 记录不一致，通知人工 |

---

## 9. 交接记录规范

### 9.1 何时创建交接记录

- 任务完成并合并 PR 后
- 跨对话/跨阶段交接时
- 遇到阻塞问题需要人工介入时

### 9.2 交接记录模板

```markdown
# 交接记录：T{编号}-{简述}

---
日期: YYYY-MM-DD
任务: T{编号}-{简述}
对话ID: session-xxx
模型: Claude Opus 5.5
状态: completed | blocked | in_progress
---

## 完成内容

### 代码变更
- ✅ 功能 1
- ✅ 功能 2

### 文档变更
- ✅ 更新 docs/XX.md

### 测试
- ✅ 单元测试：覆盖率 XX%
- ✅ 集成测试：通过
- ✅ 手动测试：通过

## 遗留问题

### 需要后续处理
1. **问题描述**
   - 优先级：高/中/低
   - 建议：在 T{编号} 处理

### 已知 Bug
- 无

## 下一步

### 阻塞
- 无

### 建议
1. 继续 T{编号} 任务
2. 建议使用 {模型} 模型

## 附加信息

### 提交记录
- 主要提交：`abc1234` - 提交说明
- 分支：feature/T{编号}-{简述}
- PR：#{编号}

### 工作树清理
- ✅ 已删除工作树
- ✅ 已删除分支

### 资源
- 任务书：docs/tasks/T{编号}.md
- 相关文档：docs/XX.md

---

**交接给**: 下一个任务的负责模型
**确认人**: @human-owner
```

### 9.3 交接记录存放

- 路径：`docs/handoff/YYYY-MM-DD-T{编号}-{简述}.md`
- 命名：日期 + 任务编号 + 简述
- 立即归档，不修改

---

## 10. 常见问题

### Q1: 如何知道使用哪个模型？

**A**: 查看任务书中的建议。一般规则：
- 核心架构、复杂业务逻辑 → Opus（强模型）
- 普通业务模块 → Sonnet（中等模型）
- UI 页面、简单功能 → Haiku（廉价模型）

### Q2: 发现文档过时怎么办？

**A**: 
1. 记录到 `docs/09-待确认清单.md`
2. 在 PR 中 @human-owner
3. 暂停相关开发，等待确认
4. **不要猜测，不要自行修改**

### Q3: Worktree 和普通分支有什么区别？

**A**: 
- 普通分支：切换分支会改变工作目录
- Worktree：每个分支有独立工作目录，互不干扰
- 好处：多个任务可并行，不用担心冲突

### Q4: PR 被拒绝了怎么办？

**A**:
1. 阅读审核意见
2. 在原分支修改代码
3. 提交新 commit（不要 amend）
4. CI 自动重新运行
5. 等待再次审核

### Q5: 如何测试需要数据库的功能？

**A**:
1. 使用 Docker Compose 启动本地数据库
2. 运行 `npx prisma migrate dev` 创建表
3. 运行 `npx prisma db seed` 初始化数据
4. 运行测试

### Q6: 任务编号从哪里来？

**A**: 任务编号由人工分配，查看 `docs/tasks/` 目录下最新的编号 +1

---

## 11. 快速参考

### 常用命令

```bash
# 创建 Worktree
git worktree add ../tenant-system-worktrees/T{编号}-{简述} -b feature/T{编号}-{简述}

# 查看所有 Worktree
git worktree list

# 删除 Worktree
git worktree remove ../tenant-system-worktrees/T{编号}-{简述}

# 运行数据库迁移
npx prisma migrate dev

# 生成 Prisma Client
npx prisma generate

# 初始化数据
npx prisma db seed

# 运行测试
npm test

# 启动开发服务器
npm run start:dev

# 检查文档
node scripts/check-docs.js
```

### 常用路径

- 文档索引：`docs/INDEX.md`
- 任务书：`docs/tasks/T{编号}.md`
- 交接记录：`docs/handoff/YYYY-MM-DD-T{编号}.md`
- 待确认清单：`docs/09-待确认清单.md`
- 样板模块：`src/modules/rooms/`

---

## 12. 更新日志

- **2026-10-11**: 初始版本，包含技术栈、Git 工作流、文档治理、安全红线

---

**重要提醒**：
1. 任何新对话开始前必须阅读本文档
2. 遇到问题先查看本文档，再查看 docs/INDEX.md
3. 发现文档不一致立即记录，不要猜测
4. 提交 PR 前检查文档是否同步

**祝开发顺利！🚀**
