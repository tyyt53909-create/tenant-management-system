# 文档治理与 Git 协作体系方案草稿

> 提交给负责人审阅
> 日期: 2026-10-11

---

## 一、方案概述

### 目标
确保多个 AI 模型、多个对话在中后期接力开发时：
- ✅ 文档始终与代码同步
- ✅ 新文档必须登记，废弃文档可追溯
- ✅ 不同对话不会产生冲突
- ✅ 新对话启动时能快速找到有效文档

### 核心原则
1. **唯一事实来源**：docs/INDEX.md 是所有文档的注册表
2. **状态驱动**：文档有明确的生命周期状态
3. **强制同步**：代码变更时相关文档必须同步更新（CI 检查）
4. **工作树隔离**：每个任务使用独立 worktree，避免冲突
5. **追溯性**：所有文档、任务、交接记录可追溯

---

## 二、文档元信息规范

### 2.1 文档头部模板

```markdown
---
status: active                          # draft | active | superseded | archived
owner_tier: strong                      # strong | medium | cheap | human
applies_to:                             # 对应的代码路径（可多个）
  - src/modules/rooms/**
  - prisma/schema.prisma
last_verified: 2026-10-11               # 最后核对日期（YYYY-MM-DD）
verified_commit: a1b2c3d                # 核对时的 Git commit hash（前7位）
supersedes: docs/old-design.md          # 取代了哪份文档（可选）
superseded_by: null                     # 被哪份文档取代（可选）
version: 1.0                            # 文档版本号
---

# 文档标题

> 简短描述

**变更历史**：
- 2026-10-11: 初始版本
- 2026-10-15: 更新数据模型（commit: xyz789）
```

### 2.2 状态定义

| 状态 | 说明 | 可操作 |
|------|------|--------|
| **draft** | 草稿，未经验证 | 可编辑、删除 |
| **active** | 生效中，作为事实来源 | 可更新（需同步更新 last_verified） |
| **superseded** | 已被新文档取代 | 只读，移入 docs/archive/ |
| **archived** | 已归档（项目不再使用） | 只读，移入 docs/archive/ |

### 2.3 owner_tier 定义

| 级别 | 说明 | 示例 |
|------|------|------|
| **human** | 人类负责维护，AI 不可修改 | 项目计划书、重大架构决策 |
| **strong** | 强模型负责，需人工审核 | 数据模型、权限矩阵、状态机 |
| **medium** | 中等模型可维护 | 普通业务模块设计 |
| **cheap** | 廉价模型可维护 | 页面设计、样式指南 |

### 2.4 applies_to 规范

使用 glob 模式指定文档覆盖的代码路径：

```yaml
applies_to:
  - src/modules/rooms/**           # 房源模块所有文件
  - prisma/schema.prisma           # 数据模型
  - src/common/guards/**           # 权限守卫
```

**特殊值**：
- `*` - 全项目
- `null` - 不对应任何代码（如 ADR、项目计划）

---

## 三、docs/INDEX.md 注册表

### 3.1 结构设计

```markdown
# 文档索引

> 最后更新: 2026-10-11
> 总文档数: 15 份（active: 12, draft: 2, superseded: 1）

---

## 核心设计文档

| 路径 | 标题 | 类型 | 状态 | 负责层级 | 覆盖范围 | 最后核对 | 说明 |
|------|------|------|------|----------|----------|----------|------|
| [00-项目计划书.md](./00-项目计划书.md) | 项目计划书 | 过程类 | active | human | 全项目 | 2026-10-11 | 阶段划分与里程碑 |
| [01-架构设计.md](./01-架构设计.md) | 架构设计 | 事实来源类 | active | strong | src/** | 2026-10-11 | 总体架构与模块边界 |
| [02-数据模型.md](./02-数据模型.md) | 数据模型 | 事实来源类 | active | strong | prisma/schema.prisma | 2026-10-11 | 实体关系图与表结构 |
| ... | ... | ... | ... | ... | ... | ... | ... |

## ADR（架构决策记录）

| 路径 | 标题 | 状态 | 决策日期 | 取代 | 被取代 |
|------|------|------|----------|------|--------|
| [adr/001-后端技术栈选型.md](./adr/001-后端技术栈选型.md) | 后端技术栈选型 | active | 2026-10-11 | - | - |
| [adr/002-多楼栋数据模型设计.md](./adr/002-多楼栋数据模型设计.md) | 多楼栋数据模型设计 | active | 2026-10-11 | - | - |

## 任务与交接

| 路径 | 标题 | 类型 | 状态 | 创建日期 | 完成日期 |
|------|------|------|------|----------|----------|
| [tasks/T001-脚手架搭建.md](./tasks/T001-脚手架搭建.md) | 脚手架搭建 | 任务书 | active | 2026-10-12 | - |
| [handoff/2026-10-12-T001.md](./handoff/2026-10-12-T001.md) | T001 交接记录 | 交接记录 | archived | 2026-10-12 | 2026-10-12 |

## 已归档文档

| 原路径 | 标题 | 归档日期 | 被取代 | 归档位置 |
|--------|------|----------|--------|----------|
| 01-old-architecture.md | 旧架构设计 | 2026-10-11 | 01-架构设计.md | archive/01-old-architecture.md |

---

## 文档类型定义

### 事实来源类（Truth Source）
必须与代码严格同步，代码变更时必须更新。包括：
- 数据模型、权限矩阵、状态机、接口规范、API 清单

### 决策类（Decision）
只新增不修改，通过 supersedes 取代旧决策。包括：
- ADR（架构决策记录）

### 过程类（Process）
记录项目过程，完成后归档。包括：
- 项目计划书、任务书、交接记录、周报

---

## 新增文档流程

1. 创建文档，填写完整元信息
2. 在 INDEX.md 中登记
3. 提交 PR，CI 自动检查
4. 合并后文档生效

## 废弃文档流程

1. 将文档状态改为 `superseded` 或 `archived`
2. 移动到 `docs/archive/` 目录
3. 在 INDEX.md 中更新状态和归档位置
4. 新文档的 `supersedes` 字段指向旧文档
```

### 3.2 INDEX.md 更新规则

| 操作 | 更新要求 | 检查点 |
|------|----------|--------|
| 新增文档 | 必须在 INDEX.md 中登记 | CI 检查是否登记 |
| 修改文档 | 更新 last_verified 和 verified_commit | CI 检查是否同步 |
| 废弃文档 | 更新状态、归档位置、取代关系 | CI 检查旧文档是否移动 |
| 删除文档 | 禁止直接删除，必须先归档 | Git hook 拦截 |

---

## 四、文档分类与更新规则

### 4.1 事实来源类（Truth Source）

**定义**：描述代码实际行为的文档，必须与代码严格同步

| 文档 | 同步触发点 | 同步要求 |
|------|------------|----------|
| **数据模型** | Prisma schema 变更 | 更新 ER 图、表结构、索引 |
| **权限矩阵** | Guard 或权限逻辑变更 | 更新权限表 |
| **状态机** | 状态枚举或流转逻辑变更 | 更新状态流转图 |
| **接口规范** | Controller 新增/修改接口 | 更新接口清单 |
| **架构设计** | 模块新增/重构 | 更新架构图和模块边界 |

**更新流程**：
1. 修改代码时，同时更新对应文档
2. PR 中说明文档变更
3. CI 检查文档 last_verified 是否更新
4. 合并后文档与代码一致

### 4.2 决策类（Decision）

**定义**：记录重大决策的文档，体现决策演进历史

| 文档 | 更新规则 | 示例 |
|------|----------|------|
| **ADR** | 只新增不修改，通过 supersedes 取代 | ADR-003 取代 ADR-001 |

**新增流程**：
1. 创建新 ADR（编号递增）
2. 如果取代旧 ADR，设置 `supersedes` 字段
3. 将旧 ADR 状态改为 `superseded`，设置 `superseded_by` 字段
4. 更新 INDEX.md

**示例**：
```markdown
# ADR-003: 多租户权限模型升级

---
status: active
supersedes: docs/adr/001-权限模型设计.md
---

## 背景
ADR-001 设计的单租户权限模型无法支持多楼栋场景...

## 决策
采用三层权限树（组织→房东→楼栋）...
```

### 4.3 过程类（Process）

**定义**：记录项目过程的文档，只追加不修改

| 文档 | 更新规则 | 归档时机 |
|------|----------|----------|
| **任务书** | 只追加更新记录，不修改原内容 | 任务完成后 |
| **交接记录** | 按日期追加新记录 | 立即归档 |
| **周报** | 每周新增一份 | 立即归档 |

**任务书更新示例**：
```markdown
# 任务书：T001-脚手架搭建

---
status: active
applies_to: null
---

## 原始需求（2026-10-12）
...

## 更新记录

### 2026-10-13：调整 Prisma 版本
**原因**：发现版本 5.7.0 有 Bug
**变更**：降级到 5.6.0
**影响**：无

### 2026-10-14：新增 Redis 依赖
**原因**：需要会话管理
**变更**：增加 @nestjs/redis
**影响**：需更新 docker-compose.yml
```

---

## 五、文档检查脚本

### 5.1 脚本位置与职责

```
scripts/
├── check-docs.js              # 主检查脚本（Node.js）
├── check-docs-sync.js         # 代码与文档同步检查
└── update-index.js            # 辅助：更新 INDEX.md 统计信息
```

### 5.2 检查项清单

| 检查项 | 触发时机 | 失败策略 |
|--------|----------|----------|
| **INDEX 一致性** | 每次 PR | 失败阻止合并 |
| **元信息完整性** | 每次 PR | 失败阻止合并 |
| **内部链接有效性** | 每次 PR | 警告但不阻止 |
| **代码变更同步文档** | 修改 applies_to 覆盖的代码 | 失败阻止合并* |
| **数据模型同步** | 修改 Prisma schema | 失败阻止合并 |
| **文档过期检查** | 每日定时 | 输出过期清单 |

*可在 PR 描述中写明 `[skip-doc-check] 原因：XXX` 跳过

### 5.3 check-docs.js 伪代码

```javascript
// scripts/check-docs.js

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const yaml = require('js-yaml');

// 1. 检查 INDEX.md 与实际文件一致
function checkIndexConsistency() {
  const index = parseIndexMd();
  const actualFiles = glob.sync('docs/**/*.md', { ignore: 'docs/INDEX.md' });
  
  const registered = index.map(doc => doc.path);
  const unregistered = actualFiles.filter(f => !registered.includes(f));
  
  if (unregistered.length > 0) {
    throw new Error(`未登记的文档: ${unregistered.join(', ')}`);
  }
}

// 2. 检查元信息完整性
function checkMetadata() {
  const docs = glob.sync('docs/**/*.md', { ignore: ['docs/INDEX.md', 'docs/archive/**'] });
  
  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    const metadata = extractMetadata(content);
    
    if (!metadata.status) {
      throw new Error(`${docPath} 缺少 status 字段`);
    }
    
    if (!['draft', 'active', 'superseded', 'archived'].includes(metadata.status)) {
      throw new Error(`${docPath} status 值非法: ${metadata.status}`);
    }
    
    if (!metadata.last_verified) {
      throw new Error(`${docPath} 缺少 last_verified 字段`);
    }
    
    // ... 其他字段检查
  }
}

// 3. 检查内部链接有效性
function checkInternalLinks() {
  const docs = glob.sync('docs/**/*.md');
  
  for (const docPath of docs) {
    const content = fs.readFileSync(docPath, 'utf-8');
    const links = extractMarkdownLinks(content);
    
    for (const link of links) {
      if (link.startsWith('./') || link.startsWith('../')) {
        const targetPath = path.resolve(path.dirname(docPath), link);
        if (!fs.existsSync(targetPath)) {
          console.warn(`⚠️  ${docPath} 中的链接失效: ${link}`);
        }
      }
    }
  }
}

// 4. 检查代码变更是否同步文档
function checkCodeDocSync(changedFiles) {
  const index = parseIndexMd();
  const docsNeedUpdate = [];
  
  for (const file of changedFiles) {
    // 查找覆盖该文件的文档
    const relatedDocs = index.filter(doc => {
      return doc.applies_to && doc.applies_to.some(pattern => {
        return minimatch(file, pattern);
      });
    });
    
    for (const doc of relatedDocs) {
      // 检查文档是否在本次 PR 中更新
      if (!changedFiles.includes(doc.path)) {
        docsNeedUpdate.push({ file, doc: doc.path });
      }
    }
  }
  
  if (docsNeedUpdate.length > 0) {
    // 检查 PR 描述中是否有 [skip-doc-check]
    const prDescription = getPRDescription();
    if (!prDescription.includes('[skip-doc-check]')) {
      throw new Error(`以下代码变更需要同步更新文档:\n${JSON.stringify(docsNeedUpdate, null, 2)}`);
    }
  }
}

// 5. 检查 Prisma schema 变更
function checkPrismaSchemaSync(changedFiles) {
  if (changedFiles.includes('prisma/schema.prisma')) {
    const dataModelDoc = 'docs/02-数据模型.md';
    
    if (!changedFiles.includes(dataModelDoc)) {
      throw new Error(`Prisma schema 已修改，必须同步更新 ${dataModelDoc}`);
    }
  }
}

// 6. 检查过期文档（定时任务）
function checkStaleDocuments() {
  const index = parseIndexMd();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const staleDocs = index.filter(doc => {
    return doc.status === 'active' && new Date(doc.last_verified) < thirtyDaysAgo;
  });
  
  if (staleDocs.length > 0) {
    console.log('📋 以下文档超过 30 天未核对:');
    staleDocs.forEach(doc => {
      console.log(`  - ${doc.path} (最后核对: ${doc.last_verified})`);
    });
  }
}

// 主函数
function main() {
  console.log('🔍 检查文档一致性...');
  checkIndexConsistency();
  
  console.log('✅ 检查元信息...');
  checkMetadata();
  
  console.log('🔗 检查内部链接...');
  checkInternalLinks();
  
  const changedFiles = getChangedFiles(); // 从 git diff 获取
  
  if (changedFiles.length > 0) {
    console.log('🔄 检查代码与文档同步...');
    checkCodeDocSync(changedFiles);
    checkPrismaSchemaSync(changedFiles);
  }
  
  console.log('✅ 所有检查通过！');
}

main();
```

### 5.4 CI 集成

```yaml
# .github/workflows/docs-check.yml
name: Docs Check

on:
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点检查过期文档

jobs:
  check-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0  # 获取完整历史以便 diff
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          npm install -g js-yaml minimatch glob
      
      - name: Run docs check
        run: node scripts/check-docs.js
      
      - name: Check stale documents (定时任务)
        if: github.event_name == 'schedule'
        run: node scripts/check-docs.js --stale
```

---

## 六、PR 模板

### 6.1 .github/pull_request_template.md

```markdown
## 📋 变更说明

简要描述本次变更的内容和原因。

## 🔗 关联任务

- 任务编号：T001
- 任务书：[T001-脚手架搭建](../docs/tasks/T001-脚手架搭建.md)
- 相关 Issue：#123

---

## 📚 文档同步清单

请确认以下项目（在完成的项目前打 ✅）：

### 代码变更类型
- [ ] 新增/修改接口（需更新 05-接口规范.md）
- [ ] 修改数据表/字段（需更新 02-数据模型.md）
- [ ] 修改权限逻辑（需更新 03-权限矩阵.md）
- [ ] 修改状态流转（需更新 04-状态机.md）
- [ ] 修改业务规则（需更新对应模块文档）
- [ ] 无以上变更（纯重构/Bug修复/测试）

### 文档更新
- [ ] 已更新相关文档
- [ ] 已更新文档的 `last_verified` 和 `verified_commit`
- [ ] 新增文档已在 docs/INDEX.md 中登记
- [ ] 已更新 STATUS.md

### 测试
- [ ] 已添加/更新单元测试
- [ ] 已添加/更新集成测试
- [ ] 手动测试通过

---

## 🚫 跳过文档检查（可选）

如果代码变更不需要更新文档，请说明原因：

```
[skip-doc-check]
原因：仅修改内部实现，未改变接口行为
```

---

## 📝 交接记录

- [ ] 已创建交接记录（docs/handoff/YYYY-MM-DD-T001.md）
- [ ] 已更新工作树状态（删除分支和 worktree）

---

## 🔍 自检清单

- [ ] 代码通过 lint 和 type-check
- [ ] 所有测试通过
- [ ] 提交信息符合规范（feat/fix/docs/refactor: 简短描述）
- [ ] 无敏感信息泄露（密钥、密码）
- [ ] 已运行 `node scripts/check-docs.js` 并通过
```

---

## 七、Git 协作规范

### 7.1 分支策略

```
main (受保护)
  ├── develop (受保护)
  │   ├── feature/T001-scaffold      # 功能分支
  │   ├── feature/T002-auth          # 功能分支
  │   └── fix/T010-billing-bug       # 修复分支
  └── hotfix/urgent-security-patch   # 紧急修复（直接从 main 分出）
```

| 分支类型 | 命名规则 | 说明 |
|----------|----------|------|
| **main** | - | 生产环境，受保护 |
| **develop** | - | 开发主线，受保护 |
| **feature/** | `feature/T编号-简述` | 功能开发 |
| **fix/** | `fix/T编号-简述` | Bug 修复 |
| **hotfix/** | `hotfix/简述` | 紧急修复 |
| **docs/** | `docs/简述` | 纯文档变更 |

### 7.2 Git Worktree 使用规范

#### 为什么使用 Worktree？
- ✅ 每个任务独立工作目录，避免分支切换冲突
- ✅ 多个任务可并行开发（不同模型/对话）
- ✅ 不影响主仓库，易于清理

#### 目录结构

```
~/projects/
├── tenant-system/              # 主仓库
│   ├── .git/                   # Git 元数据
│   ├── src/
│   ├── docs/
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

# 4. 在任务书中登记
echo "- 分支: feature/T001-scaffold" >> docs/tasks/T001-脚手架搭建.md
echo "- 工作树: ~/projects/tenant-system-worktrees/T001-scaffold" >> docs/tasks/T001-脚手架搭建.md
echo "- 模型: Opus" >> docs/tasks/T001-脚手架搭建.md
echo "- 开始时间: $(date)" >> docs/tasks/T001-脚手架搭建.md
```

#### 切换工作树

```bash
# 直接 cd 到对应工作树目录
cd ~/projects/tenant-system-worktrees/T002-auth

# 或使用别名（可写入 ~/.bashrc）
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

# 3. 删除远程分支（PR 合并后自动删除）
git branch -d feature/T001-scaffold

# 4. 在任务书中标记完成
echo "- 完成时间: $(date)" >> docs/tasks/T001-脚手架搭建.md
echo "- 状态: completed" >> docs/tasks/T001-脚手架搭建.md
```

#### 查看所有 Worktree

```bash
git worktree list

# 输出示例:
# /Users/user/projects/tenant-system              abc123 [main]
# /Users/user/projects/tenant-system-worktrees/T001-scaffold  def456 [feature/T001-scaffold]
# /Users/user/projects/tenant-system-worktrees/T002-auth      ghi789 [feature/T002-auth]
```

### 7.3 CODEOWNERS 配置

```
# .github/CODEOWNERS

# 核心模块（需人工审核）
/src/modules/auth/**           @human-owner
/src/modules/billing/**        @human-owner
/src/modules/prepay/**         @human-owner
/src/modules/checkout/**       @human-owner

# 权限和安全
/src/common/guards/**          @human-owner
/src/common/interceptors/**    @human-owner

# 数据库迁移
/prisma/migrations/**          @human-owner
/prisma/schema.prisma          @human-owner

# 关键文档
/docs/02-数据模型.md           @human-owner
/docs/03-权限矩阵.md           @human-owner
/docs/04-状态机.md             @human-owner
/docs/adr/**                   @human-owner

# 部署和配置
/.github/workflows/**          @human-owner
/docker-compose.yml            @human-owner
```

### 7.4 提交信息规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 纯文档变更
- `refactor`: 重构（不改变功能）
- `test`: 测试相关
- `chore`: 构建/工具相关

**Scope**（可选）：模块名，如 `auth`, `billing`, `rooms`

**Subject**：简短描述（<50字符）

**Body**（可选）：详细说明

**Footer**：关联任务编号

**示例**：
```
feat(auth): 实现邀请码验证逻辑

- 创建 InviteCode 实体
- 实现验证和失效逻辑
- 添加单元测试

Task: T002
```

### 7.5 任务与 Issue 对应关系

```
docs/tasks/T001-脚手架搭建.md  <-->  GitHub Issue #1
```

- **任务书（tasks/）**：详细需求、技术方案、验收标准（事实来源）
- **GitHub Issue**：仅跟踪状态（To Do / In Progress / Done）、讨论、关联 PR

**禁止**：在 Issue 中写详细需求或技术方案，避免文档分散

---

## 八、新对话启动规则

### 8.1 启动清单

新对话（新模型/新开发者）开始时，按以下顺序操作：

1. **阅读 AGENTS.md**（总规则，5分钟）
2. **阅读 docs/INDEX.md**（找到需要的文档，2分钟）
3. **阅读 status=active 的相关文档**（根据任务选择）
4. **检查任务书**（docs/tasks/T编号.md）
5. **创建 Worktree**（如果是新任务）
6. **开始工作**

### 8.2 文档不一致处理

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
3. ✅ 通知人类负责人（在 PR 中 @human-owner）
4. ⏸️  暂停相关开发，等待确认
```

### 8.3 禁止行为

| 禁止行为 | 说明 | 正确做法 |
|----------|------|----------|
| ❌ 直接修改 status=superseded 的文档 | 已废弃文档不可修改 | 创建新文档并标记 supersedes |
| ❌ 跳过 INDEX.md 登记 | 未登记文档无效 | 先登记再提交 PR |
| ❌ 修改 owner_tier=human 的文档 | 人工维护文档 AI 不可改 | 提交建议，等待人工修改 |
| ❌ 猜测文档与代码的差异原因 | 容易引入错误 | 记录不一致，通知人工 |
| ❌ 在 Issue 中写详细方案 | 文档分散 | 写入任务书，Issue 仅跟踪状态 |

---

## 九、交接记录规范

### 9.1 文件命名

```
docs/handoff/YYYY-MM-DD-T编号-简述.md
```

示例：`docs/handoff/2026-10-12-T001-scaffold-completed.md`

### 9.2 交接记录模板

```markdown
# 交接记录：T001-脚手架搭建

---
日期: 2026-10-12
任务: T001-脚手架搭建
对话ID: session-abc123
模型: Claude Opus 4
状态: completed
---

## 完成内容

### 代码变更
- ✅ 初始化 NestJS 项目
- ✅ 配置 Prisma + PostgreSQL
- ✅ 搭建 CI/CD（GitHub Actions）
- ✅ 创建 Docker Compose 配置

### 文档变更
- ✅ 更新 docs/INDEX.md
- ✅ 创建 docs/tasks/T001-脚手架搭建.md

### 测试
- ✅ 单元测试：无（基础设施）
- ✅ 集成测试：无
- ✅ 手动测试：应用可启动，连接数据库成功

## 遗留问题

### 需要后续处理
1. **Redis 配置**：本地 Docker 可用，生产环境需配置云 Redis
   - 优先级：中
   - 建议：T010 任务处理

2. **环境变量管理**：当前使用 .env 文件，生产环境需迁移到密钥管理服务
   - 优先级：高
   - 建议：上线前完成

### 已知 Bug
- 无

## 下一步

### 阻塞
- 无

### 建议
1. 继续 T002-认证模块开发
2. 建议使用 Sonnet 模型（认证逻辑适合中等模型）

## 附加信息

### 提交记录
- 主要提交：`a1b2c3d` - feat(scaffold): 初始化项目脚手架
- 分支：feature/T001-scaffold
- PR：#1

### 工作树清理
- ✅ 已删除工作树：~/projects/tenant-system-worktrees/T001-scaffold
- ✅ 已删除分支：feature/T001-scaffold

### 资源
- 任务书：docs/tasks/T001-脚手架搭建.md
- 相关文档：docs/01-架构设计.md

---

**交接给**: 下一个任务（T002）的负责模型
**确认人**: @human-owner
```

### 9.3 交接记录归档

- 立即归档到 `docs/handoff/`
- 不修改，只追加新的交接记录
- 在 docs/INDEX.md 中登记

---

## 十、方案总结

### 核心机制

1. **文档元信息** - 状态、负责层级、覆盖范围、核对日期
2. **INDEX.md** - 唯一注册表，强制登记
3. **文档分类** - 事实来源类、决策类、过程类，不同更新规则
4. **自动检查** - CI 强制同步文档与代码
5. **PR 模板** - 文档同步清单
6. **Git Worktree** - 隔离工作环境，避免冲突
7. **交接记录** - 可追溯的对话衔接

### 收益

- ✅ 文档始终是最新的（CI 强制同步）
- ✅ 新对话快速上手（只读 AGENTS.md + INDEX.md）
- ✅ 不同模型并行开发无冲突（Worktree 隔离）
- ✅ 决策和过程可追溯（ADR + 交接记录）
- ✅ 文档废弃有迹可循（supersedes 关系链）

### 成本

- ⚠️ 需要人工审核文档更新（CODEOWNERS）
- ⚠️ 需要编写和维护检查脚本
- ⚠️ 开发者需学习 Worktree 使用

---

## 审阅问题

请您审阅以上方案，并回答：

1. **文档元信息设计**：是否完整？是否有多余字段？
2. **INDEX.md 结构**：是否易于维护？是否需要工具辅助更新？
3. **文档分类**：三类文档的更新规则是否合理？
4. **检查脚本**：检查项是否覆盖所有风险点？
5. **PR 模板**：是否过于繁琐？
6. **Git Worktree**：是否适合本项目？是否有更好的方案？
7. **交接记录**：模板是否完整？是否有遗漏？
8. **新对话启动规则**：是否足够清晰？

**请您确认或提出修改意见，确认后我将立即落地文件。**
