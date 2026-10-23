import { Controller, Get, INestApplication, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
import { Public } from '../src/common/decorators/public.decorator.js';
import { Roles } from '../src/common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';

/**
 * 默认拒绝回归（T257 / SEC-01）。
 *
 * 用一个**没有标注任何守卫**的探针控制器证明：全局 JwtAuthGuard 生效后，
 * 未显式标注 @Public() 的路由在没有 Token 时返回 401；只有 @Public() 放行。
 */
const TEST_SECRET = 'deny-by-default-test-secret';

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: TEST_SECRET,
    });
  }

  validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}

@Controller('probe')
class ProbeController {
  @Get('protected')
  protectedRoute() {
    return { route: 'protected' };
  }

  @Get('public')
  @Public()
  publicRoute() {
    return { route: 'public' };
  }

  @Get('admin')
  @Roles('ADMIN')
  adminRoute() {
    return { route: 'admin' };
  }
}

describe('全域默认拒绝（T257 / SEC-01）', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController],
      providers: [
        TestJwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwtService = new JwtService({ secret: TEST_SECRET });
  });

  afterAll(async () => {
    await app.close();
  });

  it('未标注 @Public 的路由无 Token 时返回 401', async () => {
    await request(app.getHttpServer()).get('/probe/protected').expect(401);
  });

  it('@Public 路由无 Token 时返回 200', async () => {
    await request(app.getHttpServer()).get('/probe/public').expect(200).expect({ route: 'public' });
  });

  it('有效 Token 可访问受保护路由', async () => {
    const token = jwtService.sign({ sub: 'user-1', role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/probe/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ route: 'protected' });
  });

  it('JWT 有效但角色不符时返回 403（全局 RolesGuard 生效）', async () => {
    const token = jwtService.sign({ sub: 'user-2', role: 'TENANT' });
    await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('JWT 有效且角色匹配时返回 200', async () => {
    const token = jwtService.sign({ sub: 'user-3', role: 'ADMIN' });
    await request(app.getHttpServer())
      .get('/probe/admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect({ route: 'admin' });
  });
});
