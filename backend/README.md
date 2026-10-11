# 租客管理系统 - 后端

## 技术栈

- NestJS 12.x
- TypeScript 6.x
- Prisma 5.x
- PostgreSQL 16

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 到 `.env`，并修改配置：

```bash
cp .env.example .env
```

### 启动数据库（Docker）

```bash
# 见根目录的 docker-compose.yml
docker-compose up -d postgres
```

### 运行数据库迁移

```bash
npm run prisma:migrate
```

### 启动开发服务器

```bash
npm run start:dev
```

访问: http://localhost:3000

## 开发规范

### 代码风格

- 使用 Oxlint 和 Prettier
- 提交前运行 `npm run lint` 和 `npm run format`

### 模块结构

每个业务模块包含：
- `*.module.ts` - 模块定义
- `*.controller.ts` - 控制器
- `*.service.ts` - 业务逻辑
- `*.dto.ts` - 数据传输对象
- `*.entity.ts` - 实体（可选，使用 Prisma）
- `*.spec.ts` - 单元测试

### 命名规范

- 文件名：小写，短横线分隔（kebab-case）
- 类名：大驼峰（PascalCase）
- 变量/函数：小驼峰（camelCase）
- 常量：大写下划线（UPPER_SNAKE_CASE）

## 测试

```bash
# 单元测试
npm run test

# 测试覆盖率
npm run test:cov

# E2E 测试
npm run test:e2e

# 监听模式
npm run test:watch
```

## Prisma 命令

```bash
# 生成 Prisma Client
npm run prisma:generate

# 创建迁移
npm run prisma:migrate

# 查看数据库
npm run prisma:studio

# 运行种子数据
npm run prisma:seed
```

## 项目结构

```
backend/
├── src/
│   ├── main.ts                 # 入口文件
│   ├── app.module.ts           # 根模块
│   ├── app.controller.ts       # 根控制器
│   ├── app.service.ts          # 根服务
│   ├── config/                 # 配置模块
│   │   ├── app.config.ts
│   │   └── database.config.ts
│   ├── common/                 # 公共模块
│   │   ├── decorators/         # 装饰器
│   │   ├── guards/             # 守卫（权限控制）
│   │   ├── interceptors/       # 拦截器（日志、转换）
│   │   ├── filters/            # 异常过滤器
│   │   └── utils/              # 工具函数
│   └── modules/                # 业务模块
│       ├── auth/               # 认证模块
│       ├── rooms/              # 房源模块
│       ├── tenants/            # 租客模块
│       └── ...
├── prisma/
│   └── schema.prisma           # Prisma Schema
├── test/                       # E2E 测试
├── .env.example                # 环境变量模板
├── .prettierrc                 # Prettier 配置
├── .oxlintrc.json             # Oxlint 配置
├── tsconfig.json              # TypeScript 配置
├── nest-cli.json              # NestJS CLI 配置
├── package.json
└── README.md
```

## 环境变量说明

| 变量名 | 说明 | 示例 |
|--------|------|------|
| DATABASE_URL | PostgreSQL 连接字符串 | postgresql://user:password@localhost:5432/tenant_system |
| NODE_ENV | 运行环境 | development / production |
| PORT | 服务端口 | 3000 |
| JWT_SECRET | JWT 密钥 | 随机字符串 |
| JWT_EXPIRES_IN | JWT 过期时间 | 7d |
| REFRESH_TOKEN_EXPIRES_IN | 刷新令牌过期时间 | 30d |
| OSS_ACCESS_KEY_ID | 阿里云 OSS Access Key | - |
| OSS_ACCESS_KEY_SECRET | 阿里云 OSS Secret | - |
| OSS_BUCKET | OSS Bucket 名称 | tenant-system |
| OSS_REGION | OSS 区域 | oss-cn-hangzhou |
| ENCRYPTION_KEY | 数据加密密钥（32字节） | - |
| DEFAULT_BUILDING_ID | 默认楼栋ID | building-001 |

## 常见问题

### 1. 数据库连接失败

确保 PostgreSQL 已启动，并且 `.env` 中的 `DATABASE_URL` 配置正确。

### 2. Prisma Client 未生成

运行 `npm run prisma:generate` 生成 Prisma Client。

### 3. 端口被占用

修改 `.env` 中的 `PORT` 变量。

## 相关文档

- [NestJS 官方文档](https://docs.nestjs.com/)
- [Prisma 官方文档](https://www.prisma.io/docs/)
- [AGENTS.md](../../AGENTS.md) - 项目开发规范
- [技术栈选型 ADR](../../docs/adr/001-后端技术栈选型.md)
