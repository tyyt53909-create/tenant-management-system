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

```bash
git clone <repository-url>
cd tenant-management-system
```

### 2. 启动开发环境

```bash
# 一键启动所有服务（PostgreSQL + Redis）
./scripts/dev-start.sh

# 或手动启动
docker-compose up -d
```

### 3. 初始化后端

```bash
cd backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 运行数据库迁移
npm run prisma:migrate

# 启动开发服务器
npm run start:dev
```

访问: http://localhost:3000

### 4. 停止开发环境

```bash
# 一键停止
./scripts/dev-stop.sh

# 或手动停止
docker-compose down
```

## Docker 服务

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 主数据库 |
| Redis | 6379 | 缓存和会话 |

### 常用 Docker 命令

```bash
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
```

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
