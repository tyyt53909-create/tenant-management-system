import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { PrepayController } from './prepay.controller.js';
import { PrepayService } from './prepay.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

describe('预付流水 HTTP 分页转换', () => {
  let app: INestApplication;
  const rows = { data: [], meta: { total: 0 } };
  const service = {
    findTransactionsByTenant: vi.fn(),
    findAllTransactions: vi.fn(),
    createRechargeJsapiOrder: vi.fn(),
    queryAndSyncRecharge: vi.fn(),
    autoDeductBills: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service.findTransactionsByTenant.mockResolvedValue(rows);
    service.createRechargeJsapiOrder.mockResolvedValue({
      appId: 'mock-app',
      package: 'prepay_id=mock',
      outTradeNo: 'PR_001',
    });
    service.queryAndSyncRecharge.mockResolvedValue({ status: 'SUCCESS', amount: 10000 });
    service.autoDeductBills.mockResolvedValue({ deductedCount: 1, totalAmount: 5000 });

    const module = await Test.createTestingModule({
      controllers: [PrepayController], providers: [{ provide: PrepayService, useValue: service }, { provide: BusinessClock, useValue: { formatDate: () => '2026-10-24' } }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = { role: 'TENANT', tenantId: 'authenticated-tenant', userId: 'user-001' };
        return true;
      } })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(CapabilityGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterEach(async () => { await app?.close(); });

  it('字符串查询参数转换为整数，租客身份来自鉴权结果', async () => {
    await request(app.getHttpServer()).get('/prepay-accounts/transactions?page=2&limit=50').expect(200);
    expect(service.findTransactionsByTenant).toHaveBeenCalledWith('authenticated-tenant', expect.objectContaining({ page: 2, limit: 50 }));
  });
  it('缺省参数使用正常分页默认值', async () => {
    await request(app.getHttpServer()).get('/prepay-accounts/transactions').expect(200);
    expect(service.findTransactionsByTenant).toHaveBeenCalledWith('authenticated-tenant', expect.objectContaining({ page: 1, limit: 20 }));
  });
  it('拒绝超过上限的分页，防止无界查询', async () => {
    await request(app.getHttpServer()).get('/prepay-accounts/transactions?limit=101').expect(400);
    expect(service.findTransactionsByTenant).not.toHaveBeenCalled();
  });
  it('不接受客户端传入另一位租客 ID', async () => {
    await request(app.getHttpServer()).get('/prepay-accounts/transactions?tenantId=other').expect(400);
    expect(service.findTransactionsByTenant).not.toHaveBeenCalled();
  });

  it('POST /prepay-accounts/my/recharge/wechat-jsapi 接受合法金额并调用下单', async () => {
    const res = await request(app.getHttpServer())
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .send({ amount: 10000 })
      .expect(201);

    expect(res.body.outTradeNo).toBe('PR_001');
    expect(service.createRechargeJsapiOrder).toHaveBeenCalledWith('user-001', 'authenticated-tenant', 10000);
  });

  it('POST /prepay-accounts/my/recharge/wechat-jsapi 拒绝低于 100 分（1元）的充值', async () => {
    await request(app.getHttpServer())
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .send({ amount: 50 })
      .expect(400);
  });

  it('POST /prepay-accounts/my/recharge/wechat-query 校验必填单号并调用查单', async () => {
    const res = await request(app.getHttpServer())
      .post('/prepay-accounts/my/recharge/wechat-query')
      .send({ outTradeNo: 'PR_001' })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect(service.queryAndSyncRecharge).toHaveBeenCalledWith('user-001', 'authenticated-tenant', 'PR_001');
  });

  it('POST /prepay-accounts/auto-deduct 触发自动抵扣', async () => {
    const res = await request(app.getHttpServer())
      .post('/prepay-accounts/auto-deduct')
      .expect(201);

    expect(res.body.deductedCount).toBe(1);
    expect(service.autoDeductBills).toHaveBeenCalled();
  });
});
