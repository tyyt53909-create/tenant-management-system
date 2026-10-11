# 租客管理系统 - 管理后台

## 技术栈

- Vue 3 + TypeScript
- Vite 5
- Element Plus
- Vue Router
- Pinia
- Axios

## 功能模块

- ✅ 登录认证
- ✅ 仪表板
- ✅ 房源管理（完整 CRUD 示例）
- ✅ 租客管理（完整 CRUD）
- ✅ 楼栋管理（完整 CRUD）
- ✅ 合同管理（完整 CRUD）
- ✅ 账单管理（完整 CRUD）
- ✅ 报修管理（完整 CRUD）
- ✅ 水电表管理（完整 CRUD）
- ✅ 退租管理（完整 CRUD）

## 开发指南

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问：http://localhost:5173

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 默认账号

- 账号：`admin@example.com`
- 密码：`Admin@123`

## 项目结构

```
frontend-admin/
├── src/
│   ├── api/              # API 接口
│   │   ├── auth.ts       # 认证接口
│   │   └── rooms.ts      # 房源接口
│   ├── components/       # 组件
│   │   └── layout/       # 布局组件
│   ├── router/           # 路由配置
│   ├── stores/           # 状态管理
│   │   └── user.ts       # 用户状态
│   ├── types/            # 类型定义
│   ├── utils/            # 工具函数
│   │   └── request.ts    # Axios 封装
│   ├── views/            # 页面
│   │   ├── login/        # 登录页
│   │   ├── dashboard/    # 仪表板
│   │   ├── rooms/        # 房源管理
│   │   └── ...           # 其他页面
│   ├── App.vue           # 根组件
│   └── main.ts           # 入口文件
├── .env                  # 环境变量
├── vite.config.ts        # Vite 配置
└── package.json
```

## 开发说明

### 房源管理页面

`src/views/rooms/index.vue` 是一个完整的 CRUD 示例，包含：

- 列表查询（分页、筛选）
- 新增/编辑（表单验证）
- 删除（二次确认）
- 状态展示（Tag 标签）

其他业务模块可以参考这个页面的实现方式。

### 添加新页面

1. 在 `src/views/` 下创建页面组件
2. 在 `src/api/` 下创建 API 接口
3. 在 `src/router/index.ts` 中添加路由
4. 在 `MainLayout.vue` 中添加菜单项

### API 调用

```typescript
import { getRooms } from '@/api/rooms';

// 调用 API
const response = await getRooms({ page: 1, limit: 20 });
```

### 状态管理

```typescript
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
console.log(userStore.user);
```

## 注意事项

1. 确保后端服务已启动（http://localhost:3000）
2. API 请求会自动添加 JWT Token
3. Token 过期会自动刷新
4. 未登录会自动跳转登录页

## 待完成功能

- [ ] 权限控制细化
- [ ] 数据统计图表（ECharts）
- [ ] 导出功能（Excel）
- [ ] 批量操作
- [ ] 文件上传（报修图片）
- [ ] 高级搜索
