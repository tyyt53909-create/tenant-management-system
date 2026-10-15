---
status: draft
task_id: T002
stage: 阶段0
priority: P0
model_tier: 普通
estimated_hours: 3
---

# T002: 配置 Docker 开发环境

## 任务信息

- **任务编号**: T002
- **所属阶段**: 阶段0 - 准备与脚手架
- **优先级**: P0
- **建议模型档位**: 普通
- **预计工时**: 3小时
- **前置依赖**: T001（后端脚手架）
- **可并行任务**: T003（CI配置）

---

## 任务目标

配置 Docker Compose 开发环境，实现一键启动本地开发所需的所有服务（PostgreSQL、Redis）。

---

## 任务范围

### 必须完成
1. 创建 docker-compose.yml
2. 配置 PostgreSQL 服务
3. 配置 Redis 服务
4. 配置数据持久化
5. 创建开发环境启动脚本
6. 更新 README.md 添加 Docker 使用说明

### 不包括
- 生产环境 Dockerfile（延后）
- K8s 配置（不在范围）

---

## 涉及文件

### 新建文件
```
/
├── docker-compose.yml
├── docker-compose.override.yml (可选)
├── .dockerignore
└── scripts/
    └── dev-start.sh
```

### 修改文件
```
README.md
backend/.env.example
```

---

## 详细实现步骤

### 步骤1：创建 docker-compose.yml

在项目根目录创建：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: tenant-system-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: tenant_user
      POSTGRES_PASSWORD: tenant_password
      POSTGRES_DB: tenant_system
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tenant_user -d tenant_system"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - tenant-network

  redis:
    image: redis:7-alpine
    container_name: tenant-system-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - tenant-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  tenant-network:
    driver: bridge
```

### 步骤2：创建 .dockerignore

```
node_modules
npm-debug.log
dist
.git
.env
.env.local
*.md
.vscode
.idea
coverage
.DS_Store
```

### 步骤3：创建数据库初始化脚本

`scripts/init-db.sql`：

```sql
-- 设置时区
SET timezone = 'Asia/Shanghai';

-- 创建扩展（如需要）
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 初始化完成日志
DO $$
BEGIN
  RAISE NOTICE '数据库初始化完成';
END $$;
```

### 步骤4：创建开发启动脚本

`scripts/dev-start.sh`：

```bash
#!/bin/bash

echo "🚀 启动租客管理系统开发环境..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker 未运行，请先启动 Docker"
  exit 1
fi

# 启动服务
echo "📦 启动 Docker 服务..."
docker-compose up -d

# 等待服务健康检查通过
echo "⏳ 等待服务就绪..."
sleep 5

# 检查服务状态
if docker-compose ps | grep -q "Up"; then
  echo "✅ 所有服务已启动"
  echo ""
  echo "📊 服务信息:"
  echo "  PostgreSQL: localhost:5432"
  echo "  Redis: localhost:6379"
  echo ""
  echo "🔧 下一步:"
  echo "  cd backend && npm run prisma:migrate"
  echo "  npm run start:dev"
else
  echo "❌ 服务启动失败，请检查日志:"
  echo "  docker-compose logs"
fi
```

赋予执行权限：

```bash
chmod +x scripts/dev-start.sh
```

### 步骤5：创建停止脚本

`scripts/dev-stop.sh`：

```bash
#!/bin/bash

echo "🛑 停止租客管理系统开发环境..."

docker-compose down

echo "✅ 所有服务已停止"
```

赋予执行权限：

```bash
chmod +x scripts/dev-stop.sh
```

### 步骤6：更新 backend/.env.example

```env
# Database (Docker)
DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5432/tenant_system?schema=public"

# Redis (Docker)
REDIS_HOST=localhost
REDIS_PORT=6379

# ... 其他配置保持不变
```

### 步骤7：更新根目录 README.md

在根目录创建 `README.md`：

```markdown
# 租客管理系统

> 完整的租赁管理解决方案

## 项目结构

```
tenant-management-system/
├── backend/          # NestJS 后端
├── frontend-admin/   # Vue3 管理后台（待创建）
├── miniprogram/      # uni-app 小程序（待创建）
├── docs/             # 项目文档
├── scripts/          # 开发脚本
└── docker-compose.yml
```

## 快速开始

### 前置要求

- Node.js 20.x
- Docker & Docker Compose
- Git

### 1. 克隆项目

\`\`\`bash
git clone <repository-url>
cd tenant-management-system
\`\`\`

### 2. 启动开发环境

\`\`\`bash
# 一键启动所有服务（PostgreSQL + Redis）
./scripts/dev-start.sh

# 或手动启动
docker-compose up -d
\`\`\`

### 3. 初始化后端

\`\`\`bash
cd backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 运行数据库迁移
npm run prisma:migrate

# 启动开发服务器
npm run start:dev
\`\`\`

访问: http://localhost:3000

### 4. 停止开发环境

\`\`\`bash
# 一键停止
./scripts/dev-stop.sh

# 或手动停止
docker-compose down
\`\`\`

## Docker 服务

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 缓存和会话 |

### 常用 Docker 命令

\`\`\`bash
# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f postgres

# 重启服务
docker-compose restart

# 清理数据（⚠️ 会删除所有数据）
docker-compose down -v
\`\`\`

## 开发指南

详见各子项目的 README：
- [后端开发指南](./backend/README.md)
- [前端开发指南](./frontend-admin/README.md)（待创建）
- [小程序开发指南](./miniprogram/README.md)（待创建）

## 文档

- [项目计划书](./docs/00-项目计划书.md)
- [架构设计](./docs/01-架构设计.md)
- [数据模型](./docs/02-数据模型.md)
- [更多文档](./docs/INDEX.md)

## 常见问题

### Docker 启动失败

1. 检查 Docker 是否运行：`docker info`
2. 检查端口是否被占用：`lsof -i :5432` 和 `lsof -i :6379`
3. 查看错误日志：`docker-compose logs`

### 数据库连接失败

1. 确认 Docker 服务已启动：`docker-compose ps`
2. 确认 `.env` 中的数据库配置正确
3. 检查数据库健康状态：`docker-compose exec postgres pg_isready`

## 许可证

Private
```

### 步骤8：测试 Docker 环境

```bash
# 启动服务
./scripts/dev-start.sh

# 检查服务状态
docker-compose ps

# 测试 PostgreSQL 连接
docker-compose exec postgres psql -U tenant_user -d tenant_system -c "SELECT version();"

# 测试 Redis 连接
docker-compose exec redis redis-cli ping

# 停止服务
./scripts/dev-stop.sh
```

---

## 验收标准

### 功能验收
1. ✅ `docker-compose up -d` 可以启动所有服务
2. ✅ PostgreSQL 健康检查通过
3. ✅ Redis 健康检查通过
4. ✅ 可以通过 localhost:5432 连接 PostgreSQL
5. ✅ 可以通过 localhost:6379 连接 Redis
6. ✅ 数据持久化正常（重启后数据不丢失）

### 脚本验收
1. ✅ `./scripts/dev-start.sh` 可以一键启动
2. ✅ `./scripts/dev-stop.sh` 可以一键停止
3. ✅ 脚本有清晰的输出和错误提示

### 文档验收
1. ✅ README.md 包含完整的 Docker 使用说明
2. ✅ 包含常见问题和解决方案
3. ✅ 包含常用 Docker 命令参考

---

## 禁止改动项

1. ❌ 不得在此任务中创建生产环境 Dockerfile
2. ❌ 不得修改数据库表结构（留给 T101）
3. ❌ 不得配置 K8s 或其他编排工具

---

## 交付物

1. `docker-compose.yml` - Docker Compose 配置
2. `.dockerignore` - Docker 忽略规则
3. `scripts/dev-start.sh` - 一键启动脚本
4. `scripts/dev-stop.sh` - 一键停止脚本
5. `scripts/init-db.sql` - 数据库初始化脚本
6. 更新的 `README.md` - Docker 使用文档

---

## 风险与注意事项

### 风险
1. **端口冲突**: 5432 或 6379 端口可能被占用
2. **磁盘空间**: Docker 卷会占用磁盘空间

### 注意事项
1. Windows 用户需要使用 Git Bash 或 WSL 运行脚本
2. macOS 用户注意 Docker Desktop 的资源限制
3. 数据卷默认存储在 Docker 管理的位置
4. 清理数据使用 `docker-compose down -v`（会删除所有数据）

---

## 后续任务

- **T004**: 初始化数据库与迁移（使用本任务配置的 Docker PostgreSQL）
- **T101**: Prisma Schema 定义（使用本任务配置的数据库）

---

## 参考资料

- [Docker Compose 官方文档](https://docs.docker.com/compose/)
- [PostgreSQL Docker 镜像](https://hub.docker.com/_/postgres)
- [Redis Docker 镜像](https://hub.docker.com/_/redis)

---

## 开发信息

- **分支**: feature/T002-T003-infra
- **工作树**: /Users/Admin/ai/租客管理系統-worktrees/T002-T003-infra
- **模型**: Claude Opus 5.5
- **开始时间**: 2026-10-11 21:35:00
- **状态**: completed
- **完成时间**: 2026-10-11 21:45:00
