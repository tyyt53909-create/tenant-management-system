import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext,INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ManagementSummaryController } from './management-summary.controller.js';
import { ManagementSummaryService } from './management-summary.service.js';

describe('管理摘要 HTTP 权限',()=>{
  let app:INestApplication;const service={snapshot:vi.fn().mockResolvedValue({ownerId:'admin-user',rooms:{total:0}})};
  beforeEach(async()=>{
    vi.clearAllMocks();const module=await Test.createTestingModule({controllers:[ManagementSummaryController],providers:[RolesGuard,{provide:ManagementSummaryService,useValue:service}]})
      .overrideGuard(JwtAuthGuard).useValue({canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest();const role=req.headers['x-test-role'];if(!role)throw new UnauthorizedException();req.user={role,userId:role==='ADMIN'?'admin-user':'other-user'};return true;}}).compile();
    app=module.createNestApplication();await app.init();
  });
  afterEach(async()=>{await app.close();});
  it('只有 ADMIN 可访问聚合信息',async()=>{
    await request(app.getHttpServer()).get('/dashboard/management-summary').expect(401);
    for(const role of ['TENANT','CLEANER'])await request(app.getHttpServer()).get('/dashboard/management-summary').set('x-test-role',role).expect(403);
    expect(service.snapshot).not.toHaveBeenCalled();
  });
  it('管理员身份来自鉴权结果，不能用查询参数读取其他收件箱',async()=>{
    await request(app.getHttpServer()).get('/dashboard/management-summary?userId=forged').set('x-test-role','ADMIN').expect(200);
    expect(service.snapshot).toHaveBeenCalledWith('admin-user');
  });
});
