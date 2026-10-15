---
status: completed
task_id: T104
stage: 阶段1
priority: P0
model_tier: 强
estimated_hours: 4
actual_hours: 1.5
branch: feature/T104-jwt-auth
worktree: /Users/Admin/ai/租客管理系統-worktrees/T104-jwt-auth
model: Claude Opus 5.5
start_time: 2026-10-11
complete_time: 2026-10-11
pr: pending
---

# T104: JWT 认证服务

## 任务信息

- **任务编号**: T104
- **所属阶段**: 阶段1 - 核心地基与样板模块
- **优先级**: P0
- **建议模型档位**: 强
- **预计工时**: 4小时
- **前置依赖**: T101（Prisma Schema）、T102（初始化数据）、T103（数据库迁移）
- **阻塞任务**: T105-T108（认证链）、所有业务模块

---

## 任务目标

实现基于 JWT 的认证服务，包括 Token 生成、验证、刷新机制，为整个系统提供安全的用户认证基础。

---

## 任务范围

### 必须完成
1. JWT 配置（密钥、过期时间）
2. JWT Service（生成/验证 Token）
3. Access Token 和 Refresh Token 机制
4. JWT Strategy（Passport 集成）
5. Auth Guard（保护路由）
6. Token 载荷定义（userId, role, buildingId）
7. 单元测试

### 不包含
- 登录接口（T107）
- 注册接口（T106）
- 权限守卫（T109）

---

## 详细实现

### 步骤1：安装依赖

```bash
cd backend
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install -D @types/passport-jwt
```

### 步骤2：配置 JWT

**backend/src/config/jwt.config.ts**

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
}));
```

**backend/.env.example** 添加：

```env
# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

### 步骤3：JWT Service

**backend/src/modules/auth/jwt.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';

export interface JwtPayload {
  sub: string;        // userId
  role: string;       // UserRole
  buildingId?: string; // 可选，租客绑定的楼栋
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class JwtAuthService {
  constructor(
    private readonly jwtService: NestJwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 生成 Access Token 和 Refresh Token
   */
  async generateTokens(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.accessTokenExpiry'),
    });

    const refreshToken = await this.jwtService.signAsync(
      { sub: payload.sub },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.refreshTokenExpiry'),
      },
    );

    return { accessToken, refreshToken };
  }

  /**
   * 验证 Token
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.configService.get('jwt.secret'),
    });
  }

  /**
   * 从 Refresh Token 生成新的 Access Token
   */
  async refreshAccessToken(refreshToken: string, payload: JwtPayload): Promise<string> {
    // 验证 Refresh Token
    await this.verifyToken(refreshToken);

    // 生成新的 Access Token
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.accessTokenExpiry'),
    });
  }
}
```

### 步骤4：JWT Strategy

**backend/src/modules/auth/strategies/jwt.strategy.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../jwt.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    // 验证用户是否存在且激活
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    // 返回用户信息，会被附加到 request.user
    return {
      userId: payload.sub,
      role: payload.role,
      buildingId: payload.buildingId,
    };
  }
}
```

### 步骤5：Auth Module

**backend/src/modules/auth/auth.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthService } from './jwt.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import jwtConfig from '../../config/jwt.config';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.accessTokenExpiry'),
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
  ],
  providers: [JwtAuthService, JwtStrategy],
  exports: [JwtAuthService, PassportModule],
})
export class AuthModule {}
```

### 步骤6：Auth Guard

**backend/src/common/guards/jwt-auth.guard.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

### 步骤7：PrismaModule（如果还没有）

**backend/src/modules/prisma/prisma.module.ts**

```typescript
import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**backend/src/modules/prisma/prisma.service.ts**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### 步骤8：更新 AppModule

**backend/src/app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import databaseConfig from './config/database.config';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
    }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### 步骤9：单元测试

**backend/src/modules/auth/jwt.service.spec.ts**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService, JwtPayload } from './jwt.service';
import jwtConfig from '../../config/jwt.config';

describe('JwtAuthService', () => {
  let service: JwtAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [jwtConfig],
        }),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [JwtAuthService],
    }).compile();

    service = module.get<JwtAuthService>(JwtAuthService);
  });

  it('应该定义服务', () => {
    expect(service).toBeDefined();
  });

  describe('generateTokens', () => {
    it('应该生成 Access Token 和 Refresh Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });
  });

  describe('verifyToken', () => {
    it('应该验证有效的 Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);
      const verified = await service.verifyToken(tokens.accessToken);

      expect(verified.sub).toBe('user-123');
      expect(verified.role).toBe('ADMIN');
    });

    it('应该拒绝无效的 Token', async () => {
      await expect(service.verifyToken('invalid-token')).rejects.toThrow();
    });
  });

  describe('refreshAccessToken', () => {
    it('应该从 Refresh Token 生成新的 Access Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);
      const newAccessToken = await service.refreshAccessToken(
        tokens.refreshToken,
        payload,
      );

      expect(newAccessToken).toBeDefined();
      expect(typeof newAccessToken).toBe('string');

      const verified = await service.verifyToken(newAccessToken);
      expect(verified.sub).toBe('user-123');
    });
  });
});
```

---

## 验收标准

1. ✅ JWT Service 生成 Token 成功
2. ✅ JWT Service 验证 Token 成功
3. ✅ JWT Strategy 验证用户存在
4. ✅ JwtAuthGuard 可保护路由
5. ✅ 单元测试覆盖率 ≥90%
6. ✅ 配置通过环境变量管理
7. ✅ Token 包含正确的 payload（userId, role, buildingId）

---

## 交付物

1. `src/modules/auth/jwt.service.ts`
2. `src/modules/auth/strategies/jwt.strategy.ts`
3. `src/modules/auth/auth.module.ts`
4. `src/common/guards/jwt-auth.guard.ts`
5. `src/modules/prisma/prisma.service.ts`
6. `src/modules/prisma/prisma.module.ts`
7. `src/config/jwt.config.ts`
8. 单元测试文件

---

## 后续任务

- **T105**: 邀请码生成与验证逻辑
- **T106**: 用户注册接口
- **T107**: 用户登录接口
- **T108**: Token 刷新接口

---

## 参考资料

- [NestJS JWT 文档](https://docs.nestjs.com/security/authentication#jwt-token)
- [Passport JWT 文档](http://www.passportjs.org/packages/passport-jwt/)
