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
  const service = { findTransactionsByTenant: vi.fn(), findAllTransactions: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    service.findTransactionsByTenant.mockResolvedValue(rows);
    const module = await Test.createTestingModule({
      controllers: [PrepayController], providers: [{ provide: PrepayService, useValue: service }, { provide: BusinessClock, useValue: { formatDate: () => '2026-10-24' } }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
        context.switchToHttp().getRequest().user = { role: 'TENANT', tenantId: 'authenticated-tenant' };
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

  it('租客发起微信充值下单参数校验与服务调用', async () => {
    (service as any).createJsapiRechargeOrder = vi.fn().mockResolvedValue({
      appId: 'wx-app',
      outTradeNo: 'PREPAY_1',
      orderId: 'order-1',
    });

    const res = await request(app.getHttpServer())
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .send({ amount: 10000 })
      .expect(201);

    expect(res.body).toEqual({
      appId: 'wx-app',
      outTradeNo: 'PREPAY_1',
      orderId: 'order-1',
    });
    expect((service as any).createJsapiRechargeOrder).toHaveBeenCalledWith(
      { amount: 10000 },
      expect.objectContaining({ role: 'TENANT', tenantId: 'authenticated-tenant' }),
    );
  });

  it('充值主动查单校验与服务调用', async () => {
    (service as any).queryAndSyncRechargeOrder = vi.fn().mockResolvedValue({
      orderId: 'order-1',
      outTradeNo: 'PREPAY_1',
      status: 'SUCCESS',
      amount: 10000,
    });

    const res = await request(app.getHttpServer())
      .post('/prepay-accounts/my/recharge/wechat-query')
      .send({ outTradeNo: 'PREPAY_1' })
      .expect(201);

    expect(res.body.status).toBe('SUCCESS');
    expect((service as any).queryAndSyncRechargeOrder).toHaveBeenCalledWith(
      { outTradeNo: 'PREPAY_1' },
      expect.objectContaining({ role: 'TENANT', tenantId: 'authenticated-tenant' }),
    );
  });
});
