import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { InviteCodeService } from '../src/modules/auth/invite-code.service.js';
import { JwtAuthService } from '../src/modules/auth/jwt.service.js';
import { BillsController } from '../src/modules/bills/bills.controller.js';
import { WechatPaymentService } from '../src/modules/bills/payment/wechat-payment.service.js';
import { PaymentRefundService } from '../src/modules/bills/payment/payment-refund.service.js';
import { BillsService } from '../src/modules/bills/bills.service.js';
import { BillPaymentService } from '../src/modules/bills/bill-payment.service.js';
import { BuildingsController } from '../src/modules/buildings/buildings.controller.js';
import { BuildingsService } from '../src/modules/buildings/buildings.service.js';
import { CheckoutController } from '../src/modules/checkout/checkout.controller.js';
import { CheckoutService } from '../src/modules/checkout/checkout.service.js';
import { ContractsController } from '../src/modules/contracts/contracts.controller.js';
import { ContractsService } from '../src/modules/contracts/contracts.service.js';
import { MaintenanceController } from '../src/modules/maintenance/maintenance.controller.js';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service.js';
import { ImportsController } from '../src/modules/imports/imports.controller.js';
import { ImportsService } from '../src/modules/imports/imports.service.js';
import { PrepayController } from '../src/modules/prepay/prepay.controller.js';
import { PublicUtilitiesController } from '../src/modules/public-utilities/public-utilities.controller.js';
import { PublicUtilitiesService } from '../src/modules/public-utilities/public-utilities.service.js';
import { PrepayService } from '../src/modules/prepay/prepay.service.js';
import { MetersController } from '../src/modules/meters/meters.controller.js';
import { MetersService } from '../src/modules/meters/meters.service.js';
import { MetersSimulatorService } from '../src/modules/meters/meters-simulator.service.js';
import { MeterReconciliationService } from '../src/modules/meters/meter-reconciliation.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { RoomsController } from '../src/modules/rooms/rooms.controller.js';
import { RoomsService } from '../src/modules/rooms/rooms.service.js';
import { TenantCapabilityService } from '../src/modules/tenant-capabilities/tenant-capability.service.js';
import { TenantsController } from '../src/modules/tenants/tenants.controller.js';
import { TagsController } from '../src/modules/tags/tags.controller.js';
import { TenantsService } from '../src/modules/tenants/tenants.service.js';
import { TagsService } from '../src/modules/tags/tags.service.js';
import { SpaceController } from '../src/modules/space/space.controller.js';
import { SpaceService } from '../src/modules/space/space.service.js';
import { FloorPlansController } from '../src/modules/floor-plans/floor-plans.controller.js';
import { FloorPlansService } from '../src/modules/floor-plans/floor-plans.service.js';
import { LeadsController } from '../src/modules/leads/leads.controller.js';
import { LeadsService } from '../src/modules/leads/leads.service.js';
import { AppointmentsController } from '../src/modules/appointments/appointments.controller.js';
import { AppointmentsService } from '../src/modules/appointments/appointments.service.js';
import { ContractTemplatesController } from '../src/modules/contracts/contract-templates.controller.js';
import { ContractTemplatesService } from '../src/modules/contracts/contract-templates.service.js';
import { ContractRenewalsService } from '../src/modules/contracts/contract-renewals.service.js';
import { InspectionsController } from '../src/modules/inspections/inspections.controller.js';
import { InspectionsService } from '../src/modules/inspections/inspections.service.js';
import { CheckoutRequestsService } from '../src/modules/checkout/checkout-requests.service.js';
import { StaffController } from '../src/modules/staff/staff.controller.js';
import { StaffService } from '../src/modules/staff/staff.service.js';
import { BusinessClock } from '../src/common/business-clock/business-clock.service.js';

/**
 * 越权回归测试（T148）
 *
 * 通过真实的 JwtAuthGuard（用测试替身注入角色）+ 真实的 RolesGuard + 真实控制器路由，
 * 以 HTTP 请求验证 docs/03-权限矩阵.md 的角色边界。
 */
const fakeJwtGuard = {
  canActivate: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) {
      throw new UnauthorizedException('未登录');
    }
    req.user = {
      userId: `user-${String(role).toLowerCase()}`,
      role,
      tenantId: req.headers['x-test-tenant'] ?? (role === 'TENANT' ? 'tenant-self' : undefined),
    };
    return true;
  },
};

const as = (req: request.Test, role: string, tenantId?: string) => {
  req.set('x-test-role', role);
  if (tenantId) req.set('x-test-tenant', tenantId);
  return req;
};

describe('接口越权回归（T148，真实守卫 + HTTP）', () => {
  let app: INestApplication;
  let tenantsService: any;
  let billsService: any;
  let checkoutService: any;

  beforeAll(async () => {
    tenantsService = {
      create: vi.fn().mockResolvedValue({ id: 'tenant-new' }),
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
      findOneForTenant: vi.fn(async (id: string, tenantId?: string) => {
        if (!tenantId || tenantId !== id) throw new NotFoundException('租客不存在');
        return { id };
      }),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const publicUtilitiesService = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'pu-1' }),
      preview: vi.fn().mockResolvedValue({ allocations: [] }),
      create: vi.fn().mockResolvedValue({ id: 'pu-1' }),
      generateBills: vi.fn().mockResolvedValue({ created: 0 }),
      remove: vi.fn().mockResolvedValue({ message: '单据已删除' }),
    };
    const importsService = {
      template: vi.fn().mockReturnValue('name,phone\r\n张三,13800138000\r\n'),
      preview: vi.fn().mockResolvedValue({ entity: 'tenants', totalRows: 0, skipped: 0, imported: 0, errors: [], dryRun: true }),
      commit: vi.fn().mockResolvedValue({ entity: 'tenants', totalRows: 0, skipped: 0, imported: 0, errors: [], dryRun: true }),
    };
    const tagsService = {
      findAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'tag-new', name: '学生', sort: 0 }),
      update: vi.fn().mockResolvedValue({ id: 'tag-1', name: '学生', sort: 0 }),
      remove: vi.fn().mockResolvedValue({ message: '标签已删除', affectedTenants: 0 }),
    };
    billsService = {
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'bill-mine' }),
      findOneForTenant: vi.fn(async (id: string, tenantId?: string) => {
        if (id !== 'bill-mine' || tenantId !== 'tenant-self') {
          throw new NotFoundException('账单不存在');
        }
        return { id };
      }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      addPayment: vi.fn(),
      findPayments: vi.fn(),
      addLateFee: vi.fn(),
      findLateFees: vi.fn(),
    };
    checkoutService = {
      findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      findOne: vi.fn().mockResolvedValue({ id: 'checkout-1' }),
      findOneForTenant: vi.fn(async (id: string, tenantId?: string) => {
        if (id !== 'checkout-mine' || tenantId !== 'tenant-self') {
          throw new NotFoundException('退租记录不存在');
        }
        return { id };
      }),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicUtilitiesController,
        TenantsController,
        ImportsController,
        TagsController,
        BillsController,
        ContractsController,
        MaintenanceController,
        CheckoutController,
        BuildingsController,
        MetersController,
        RoomsController,
        AuthController,
        PrepayController,
        LeadsController,
        AppointmentsController,
        ContractTemplatesController,
        InspectionsController,
        StaffController,
      ],
      providers: [
        // AuthController 依赖 ConfigService 决定 refresh cookie 的 Secure 标志
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) },
        { provide: BusinessClock, useValue: new BusinessClock(new ConfigService({ NODE_ENV: 'test' })) },
        { provide: TenantsService, useValue: tenantsService },
        { provide: PublicUtilitiesService, useValue: publicUtilitiesService },
        { provide: ImportsService, useValue: importsService },
        { provide: TagsService, useValue: tagsService },
        { provide: BillsService, useValue: billsService },
        {
          provide: BillPaymentService,
          useValue: {
            payWithPrepay: vi.fn(),
            addPayment: vi.fn(),
            findPayments: vi.fn(),
          },
        },
        {
          provide: WechatPaymentService,
          useValue: {
            createJsapiOrder: vi.fn(),
            queryAndSyncPayment: vi.fn(),
            handleNotify: vi.fn(),
          },
        },
        {
          provide: PaymentRefundService,
          useValue: {
            createRefund: vi.fn(),
            handleRefundNotify: vi.fn(),
            getBillRefunds: vi.fn(),
          },
        },
        { provide: CheckoutService, useValue: checkoutService },
        {
          provide: CheckoutRequestsService,
          useValue: {
            create: vi.fn().mockResolvedValue({ id: 'req-1' }),
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findOne: vi.fn().mockResolvedValue({ id: 'req-1' }),
            findOneForTenant: vi.fn().mockResolvedValue({ id: 'req-1' }),
            review: vi.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
            cancel: vi.fn().mockResolvedValue({ id: 'req-1', status: 'CANCELLED' }),
          },
        },
        {
          provide: InspectionsService,
          useValue: {
            getTemplateItems: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue({ id: 'insp-1' }),
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findOne: vi.fn().mockResolvedValue({ id: 'insp-1' }),
            findOneForTenant: vi.fn().mockResolvedValue({ id: 'insp-1' }),
            update: vi.fn().mockResolvedValue({ id: 'insp-1' }),
            confirm: vi.fn().mockResolvedValue({ id: 'insp-1', status: 'CONFIRMED' }),
            remove: vi.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: ContractsService,
          useValue: {
            findAll: vi.fn(),
            findByTenant: vi.fn(),
            findOne: vi.fn(),
            findOneForTenant: vi.fn(async (id: string, tenantId?: string) => {
              if (id !== 'contract-mine' || tenantId !== 'tenant-self') {
                throw new NotFoundException('合同不存在');
              }
              return { id };
            }),
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            generatePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
            addCoTenant: vi.fn().mockResolvedValue({ id: 'cot-1' }),
            removeCoTenant: vi.fn().mockResolvedValue({ success: true }),
            initiateSignFlow: vi.fn().mockResolvedValue({ flowId: 'f1', signUrl: 'https://sign' }),
            getSignStatus: vi.fn().mockResolvedValue({ flowId: 'f1', status: 'SIGNING' }),
            mockCompleteSign: vi.fn().mockResolvedValue({ id: 'c1', signStatus: 'SIGNED' }),
            handleSignCallback: vi.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: ContractTemplatesService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findDefault: vi.fn().mockResolvedValue({ id: 'tmpl-1', name: '默认' }),
            findOne: vi.fn().mockResolvedValue({ id: 'tmpl-1' }),
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
        {
          provide: ContractRenewalsService,
          useValue: {
            findExpiringContracts: vi.fn().mockResolvedValue([]),
            findHoldoverContracts: vi.fn().mockResolvedValue([]),
            findAllRenewalIntents: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findAllRenewalOffers: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findMyRenewalOffers: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            respondRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro-1', status: 'ACCEPTED' }),
            cancelRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro-1', status: 'CANCELLED' }),
            submitRenewalIntent: vi.fn().mockResolvedValue({ id: 'ri-1', intent: 'RENEW' }),
            getRenewalIntent: vi.fn(async (id: string, tenantId?: string, isTenant = true) => {
              if (isTenant && (!tenantId || tenantId !== 'tenant-self')) {
                throw new NotFoundException('合同不存在');
              }
              return { id: 'ri-1', intent: 'RENEW' };
            }),
            createRenewalOffer: vi.fn().mockResolvedValue({ id: 'ro-1' }),
          },
        },
        {
          provide: MaintenanceService,
          useValue: {
            findAll: vi.fn(),
            findByTenant: vi.fn(),
            findOne: vi.fn(),
            findOneForTenant: vi.fn(async (id: string, tenantId?: string) => {
              if (id !== 'mr-mine' || tenantId !== 'tenant-self') {
                throw new NotFoundException('报修工单不存在');
              }
              return { id };
            }),
            findMessages: vi.fn(async (id: string, user: { role?: string; tenantId?: string }) => {
              if (user.role === 'TENANT' && (id !== 'mr-mine' || user.tenantId !== 'tenant-self')) {
                throw new NotFoundException('报修记录不存在');
              }
              return { data: [] };
            }),
            addMessage: vi.fn(async (id: string, _dto: unknown, user: { role?: string; tenantId?: string }) => {
              if (user.role === 'TENANT' && (id !== 'mr-mine' || user.tenantId !== 'tenant-self')) {
                throw new NotFoundException('报修记录不存在');
              }
              return { id: 'msg-1' };
            }),
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
        {
          provide: StaffService,
          useValue: {
            list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
            create: vi.fn().mockResolvedValue({ id: 's1', role: 'PROPERTY_MANAGER' }),
            findOne: vi.fn().mockResolvedValue({ id: 's1' }),
            update: vi.fn().mockResolvedValue({ id: 's1' }),
            resetPassword: vi.fn().mockResolvedValue({ message: 'ok' }),
            assignBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
            getAssignedBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
            getMyBuildings: vi.fn().mockResolvedValue([{ id: 'b1' }]),
          },
        },
        {
          provide: RoomsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findOne: vi.fn().mockResolvedValue({ id: 'room-1' }),
            create: vi.fn(),
            update: vi.fn(),
            updateStatus: vi.fn(),
            markClean: vi.fn(),
            remove: vi.fn(),
          },
        },
        { provide: BuildingsService, useValue: { findAll: vi.fn(), findOne: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
        { provide: MetersService, useValue: { findAll: vi.fn(), findOne: vi.fn(), createReading: vi.fn(), findReadings: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
        { provide: MetersSimulatorService, useValue: { runSimulation: vi.fn() } },
        { provide: MeterReconciliationService, useValue: { reconcile: vi.fn().mockResolvedValue({ period: '2026-01', rows: [], summary: {} }) } },
        // 能力守卫放行（能力拒绝由 tenant-capability 专属测试覆盖；本文件聚焦服务层隔离）
        {
          provide: PrepayService,
          useValue: {
            findByTenant: vi.fn().mockResolvedValue({ id: 'pa-1', tenantId: 'tenant-self', balanceCache: 0 }),
            findTransactionsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findAllTransactions: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
          },
        },
        { provide: TenantCapabilityService, useValue: { hasCapability: vi.fn().mockResolvedValue(true) } },
        {
          provide: InviteCodeService,
          useValue: {
            generateInviteCode: vi.fn().mockResolvedValue('INVITE-generated'),
            validateInviteCode: vi.fn().mockResolvedValue({ valid: true, invitedBy: 'admin-1' }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            register: vi.fn(),
            login: vi.fn(),
            generateInviteCode: vi.fn().mockImplementation(async (_userId: string, dto?: { expiryDays?: number }) => ({ inviteCode: 'INVITE-generated', expiryDays: dto?.expiryDays ?? 365 })),
            listInviteCodes: vi.fn(),
            revokeInviteCode: vi.fn(),
            refresh: vi.fn(),
            logout: vi.fn(),
            logoutAll: vi.fn(),
            getMe: vi.fn(),
            getGoogleClientId: vi.fn(),
          },
        },
        {
          provide: JwtAuthService,
          useValue: { generateTokens: vi.fn(), verifyToken: vi.fn(), refreshAccessToken: vi.fn() },
        },
        {
          provide: LeadsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findOne: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
        {
          provide: AppointmentsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
            findMy: vi.fn().mockResolvedValue([]),
            findOne: vi.fn(),
            confirm: vi.fn(),
            complete: vi.fn(),
            cancel: vi.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, tenant: { create: vi.fn() }, $transaction: vi.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('未登录一律 401', () => {
    it('GET /tenants 未登录 → 401', async () => {
      await request(app.getHttpServer()).get('/tenants').expect(401);
    });

    it('GET /bills/:id 未登录 → 401', async () => {
      await request(app.getHttpServer()).get('/bills/bill-mine').expect(401);
    });

    it('POST /auth/invite-codes 未登录 → 401', async () => {
      await request(app.getHttpServer()).post('/auth/invite-codes').send({}).expect(401);
    });
  });

  describe('CLEANER（保洁）不得访问租客 / 合同 / 账单 / 退租 / 楼栋 / 水电表', () => {
    it('GET /tenants（租客列表）→ 403（T148 核心回归）', async () => {
      await as(request(app.getHttpServer()).get('/tenants'), 'CLEANER').expect(403);
      expect(tenantsService.findAll).not.toHaveBeenCalled();
    });

    it('GET /tenants/:id（租客详情）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/tenants/tenant-1'), 'CLEANER').expect(403);
    });

    it('GET /contracts（合同列表）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/contracts'), 'CLEANER').expect(403);
    });

    it('GET /bills（账单列表）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/bills'), 'CLEANER').expect(403);
    });

    it('GET /checkout（退租记录）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/checkout'), 'CLEANER').expect(403);
      expect(checkoutService.findAll).not.toHaveBeenCalled();
      expect(checkoutService.findByTenant).not.toHaveBeenCalled();
    });

    it('GET /buildings（楼栋）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/buildings'), 'CLEANER').expect(403);
    });

    it('GET /meters（水电表）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/meters'), 'CLEANER').expect(403);
    });

    it('POST /rooms（创建房源，管理接口）→ 403', async () => {
      await as(request(app.getHttpServer()).post('/rooms').send({}), 'CLEANER').expect(403);
    });

    it('POST /auth/invite-codes（发放邀请码，管理接口）→ 403', async () => {
      await as(request(app.getHttpServer()).post('/auth/invite-codes').send({}), 'CLEANER').expect(403);
    });
  });

  describe('TENANT（租客）不得调用管理接口、不得读他人数据', () => {
    it('GET /tenants（租客列表）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/tenants'), 'TENANT').expect(403);
      expect(tenantsService.findAll).not.toHaveBeenCalled();
    });

    it('POST /tenants（创建租客档案，管理接口）→ 403', async () => {
      await as(request(app.getHttpServer()).post('/tenants').send({}), 'TENANT').expect(403);
      expect(tenantsService.create).not.toHaveBeenCalled();
    });

    it('GET /bills（全量账单列表，管理接口）→ 403', async () => {
      await as(request(app.getHttpServer()).get('/bills'), 'TENANT').expect(403);
    });

    it('GET /bills/:id 他人账单 → 404（服务层按 tenantId 隔离）', async () => {
      await as(request(app.getHttpServer()).get('/bills/bill-other'), 'TENANT').expect(404);
      expect(billsService.findOneForTenant).toHaveBeenCalledWith('bill-other', 'tenant-self');
      expect(billsService.findOne).not.toHaveBeenCalled();
    });

    it('GET /bills/:id 自己的账单 → 200', async () => {
      await as(request(app.getHttpServer()).get('/bills/bill-mine'), 'TENANT').expect(200);
      expect(billsService.findOneForTenant).toHaveBeenCalledWith('bill-mine', 'tenant-self');
    });

    it('GET /contracts/:id 他人合同 → 404', async () => {
      await as(request(app.getHttpServer()).get('/contracts/contract-other'), 'TENANT').expect(404);
    });

    it('GET /maintenance/:id 他人工单 → 404', async () => {
      await as(request(app.getHttpServer()).get('/maintenance/mr-other'), 'TENANT').expect(404);
    });

    it('GET /maintenance/:id/messages 他人工单 → 404', async () => {
      await as(request(app.getHttpServer()).get('/maintenance/mr-other/messages'), 'TENANT').expect(404);
    });

    it('GET /maintenance/:id/messages 自己的工单 → 200', async () => {
      await as(request(app.getHttpServer()).get('/maintenance/mr-mine/messages'), 'TENANT').expect(200);
    });

    it('POST /maintenance/:id/messages 他人工单 → 404', async () => {
      await as(request(app.getHttpServer()).post('/maintenance/mr-other/messages').send({ body: 'hello' }), 'TENANT').expect(404);
    });

    it('GET /maintenance/:id/messages 未登录 → 401，保洁 → 403', async () => {
      await request(app.getHttpServer()).get('/maintenance/mr-mine/messages').expect(401);
      await as(request(app.getHttpServer()).get('/maintenance/mr-mine/messages'), 'CLEANER').expect(403);
    });

    it('GET /checkout 租客仅走自己的记录（不调用全量查询）', async () => {
      await as(request(app.getHttpServer()).get('/checkout'), 'TENANT').expect(200);
      expect(checkoutService.findByTenant).toHaveBeenCalledWith('tenant-self', expect.anything());
      expect(checkoutService.findAll).not.toHaveBeenCalled();
    });

    it('GET /checkout/:id 他人退租记录 → 404', async () => {
      await as(request(app.getHttpServer()).get('/checkout/checkout-other'), 'TENANT').expect(404);
      expect(checkoutService.findOne).not.toHaveBeenCalled();
    });

    it('GET /tenants/:id 自己的档案 → 200（走 findOneForTenant）', async () => {
      await as(request(app.getHttpServer()).get('/tenants/tenant-self'), 'TENANT').expect(200);
      expect(tenantsService.findOneForTenant).toHaveBeenCalledWith('tenant-self', 'tenant-self');
      expect(tenantsService.findOne).not.toHaveBeenCalled();
    });

    it('GET /tenants/:id 他人档案 → 404（不暴露存在性）', async () => {
      await as(request(app.getHttpServer()).get('/tenants/tenant-other'), 'TENANT').expect(404);
    });

    it('POST /rooms（创建房源，管理接口）→ 403', async () => {
      await as(request(app.getHttpServer()).post('/rooms').send({}), 'TENANT').expect(403);
    });
  });

  describe('租客端 /my 与 /transactions 路由（T209 补矩阵）', () => {
    const routes = [
      '/bills/my',
      '/contracts/my',
      '/contracts/renewal-offers/my',
      '/maintenance/my',
      '/prepay-accounts/my',
      '/prepay-accounts/transactions',
    ];

    it('未登录访问这些路由一律 401', async () => {
      for (const path of routes) {
        const res = await request(app.getHttpServer()).get(path);
        expect(`${path} → ${res.status}`).toBe(`${path} → 401`);
      }
    });

    it('CLEANER（保洁）一律 403', async () => {
      for (const path of routes) {
        const res = await as(request(app.getHttpServer()).get(path), 'CLEANER');
        expect(`${path} → ${res.status}`).toBe(`${path} → 403`);
      }
    });

    it('TENANT 可访问，且范围参数是自己的 tenantId', async () => {
      for (const path of routes) {
        const res = await as(request(app.getHttpServer()).get(path), 'TENANT', 'tenant-self');
        expect(`${path} → ${res.status}`).toBe(`${path} → 200`);
      }
      expect(app.get(BillsService).findByTenant).toHaveBeenCalledWith('tenant-self', expect.anything());
    });

    it('TENANT 但没有租客档案 → 控制器传空范围（真实服务经 scopedWhere 直接 403，不再退化成 userId）', async () => {
      const res = await request(app.getHttpServer())
        .get('/bills/my')
        .set('x-test-role', 'TENANT')
        .set('x-test-tenant', '');

      expect(res.status).toBe(200); // 服务在本 e2e 里被 mock；重点是下面这行的范围参数
      expect(app.get(BillsService).findByTenant).toHaveBeenCalledWith('', expect.anything());
    });
  });

  describe('水电对账（T218）', () => {
    it('未登录 → 401', async () => {
      await request(app.getHttpServer()).get('/meters/reconciliation').expect(401);
    });

    it('CLEANER 与 TENANT → 403', async () => {
      for (const role of ['CLEANER', 'TENANT']) {
        await as(request(app.getHttpServer()).get('/meters/reconciliation'), role).expect(403);
      }
    });

    it('ADMIN → 200', async () => {
      await as(request(app.getHttpServer()).get('/meters/reconciliation?period=2026-01'), 'ADMIN').expect(200);
    });
  });

  describe('公共水电分摊（T217）', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'get', path: '/public-utilities' },
      { method: 'post', path: '/public-utilities/preview' },
      { method: 'post', path: '/public-utilities' },
      { method: 'post', path: '/public-utilities/pu-1/generate-bills' },
    ];

    it('未登录一律 401', async () => {
      for (const { method, path } of routes) {
        await request(app.getHttpServer())[method](path).expect(401);
      }
    });

    it('CLEANER 与 TENANT 一律 403（分摊是管理操作）', async () => {
      for (const role of ['CLEANER', 'TENANT']) {
        for (const { method, path } of routes) {
          await as(request(app.getHttpServer())[method](path), role).expect(403);
        }
      }
    });

    it('ADMIN 列表 → 200', async () => {
      await as(request(app.getHttpServer()).get('/public-utilities'), 'ADMIN').expect(200);
    });
  });

  describe('旧资料导入（T216）', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'get', path: '/imports/tenants/template' },
      { method: 'post', path: '/imports/tenants/preview' },
      { method: 'post', path: '/imports/tenants/commit' },
    ];

    it('未登录一律 401', async () => {
      for (const { method, path } of routes) {
        await request(app.getHttpServer())[method](path).expect(401);
      }
    });

    it('CLEANER 一律 403', async () => {
      for (const { method, path } of routes) {
        await as(request(app.getHttpServer())[method](path), 'CLEANER').expect(403);
      }
    });

    it('TENANT 一律 403（导入是管理操作）', async () => {
      for (const { method, path } of routes) {
        await as(request(app.getHttpServer())[method](path), 'TENANT').expect(403);
      }
    });

    it('ADMIN 下载模板 → 200 text/csv', async () => {
      const res = await as(request(app.getHttpServer()).get('/imports/tenants/template'), 'ADMIN').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });

  describe('标签字典（T215）', () => {
    const adminWrites: { method: 'post' | 'patch' | 'delete'; path: string }[] = [
      { method: 'post', path: '/tags' },
      { method: 'patch', path: '/tags/tag-1' },
      { method: 'delete', path: '/tags/tag-1' },
    ];

    it('未登录一律 401', async () => {
      await request(app.getHttpServer()).get('/tags').expect(401);
      for (const { method, path } of adminWrites) {
        await request(app.getHttpServer())[method](path).expect(401);
      }
    });

    it('CLEANER 可读、不可改', async () => {
      await as(request(app.getHttpServer()).get('/tags'), 'CLEANER').expect(200);
      for (const { method, path } of adminWrites) {
        await as(request(app.getHttpServer())[method](path), 'CLEANER').expect(403);
      }
    });

    it('TENANT 可读（打标签时的候选）、不可改', async () => {
      await as(request(app.getHttpServer()).get('/tags'), 'TENANT', 'tenant-self').expect(200);
      for (const { method, path } of adminWrites) {
        await as(request(app.getHttpServer())[method](path), 'TENANT', 'tenant-self').expect(403);
      }
    });

    it('TENANT 无租客档案仍可读标签（标签本身与租客档案无关）', async () => {
      await request(app.getHttpServer())
        .get('/tags')
        .set('x-test-role', 'TENANT')
        .set('x-test-tenant', '')
        .expect(200);
    });

    it('ADMIN 可读可写', async () => {
      await as(request(app.getHttpServer()).get('/tags'), 'ADMIN').expect(200);
      await as(request(app.getHttpServer()).post('/tags').send({ name: '学生' }), 'ADMIN').expect(201);
    });
  });

  describe('招租管线与看房预约（LSE-01 / T298）', () => {
    it('线索管理：未登录 401，TENANT/CLEANER 403，ADMIN 200', async () => {
      await request(app.getHttpServer()).get('/leads').expect(401);
      await as(request(app.getHttpServer()).get('/leads'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/leads'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/leads'), 'ADMIN').expect(200);
    });

    it('看房预约管理：全量预约未登录 401，TENANT 403，ADMIN 200；租客本人预约允许 TENANT 访问', async () => {
      await request(app.getHttpServer()).get('/appointments').expect(401);
      await as(request(app.getHttpServer()).get('/appointments'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/appointments'), 'ADMIN').expect(200);

      // 租客访问本人预约端点 /appointments/my
      await as(request(app.getHttpServer()).get('/appointments/my'), 'TENANT', 'tenant-self').expect(200);
    });
  });

  describe('合同条款模板与电子签约（LSE-02 / T299）', () => {
    it('合同模板：未登录 401，TENANT 仅能查看默认/详情，ADMIN 可管理列表与增删改', async () => {
      await request(app.getHttpServer()).get('/contract-templates').expect(401);
      await as(request(app.getHttpServer()).get('/contract-templates'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/contract-templates'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/contract-templates'), 'ADMIN').expect(200);

      // 租客查看默认模板
      await as(request(app.getHttpServer()).get('/contract-templates/default'), 'TENANT', 'tenant-self').expect(200);
    });

    it('合同 PDF 导出与签约状态：租客/ADMIN 允许，CLEANER 403', async () => {
      await as(request(app.getHttpServer()).get('/contracts/c1/pdf'), 'ADMIN').expect(200);
      await as(request(app.getHttpServer()).get('/contracts/c1/pdf'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).get('/contracts/c1/pdf'), 'CLEANER').expect(403);

      await as(request(app.getHttpServer()).get('/contracts/c1/sign/status'), 'ADMIN').expect(200);
      await as(request(app.getHttpServer()).get('/contracts/c1/sign/status'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).get('/contracts/c1/sign/status'), 'CLEANER').expect(403);
    });

    it('电子签约发起与共同承租人：仅 ADMIN 拥有操作权限', async () => {
      await as(request(app.getHttpServer()).post('/contracts/c1/sign/initiate'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/contracts/c1/sign/initiate'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).post('/contracts/c1/sign/initiate'), 'ADMIN').expect(201);

      await as(request(app.getHttpServer()).post('/contracts/c1/co-tenants'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/contracts/c1/co-tenants'), 'ADMIN').expect(201);
    });
  });

  describe('验房交接与退租申请（LSE-03 / T300）', () => {
    it('验房单：全量与创建未登录 401，TENANT 仅能查看本人及确认，ADMIN 可全量管理', async () => {
      await request(app.getHttpServer()).get('/inspections').expect(401);
      await as(request(app.getHttpServer()).get('/inspections'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/inspections'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/inspections'), 'ADMIN').expect(200);

      // 创建仅管理员
      await as(request(app.getHttpServer()).post('/inspections').send({ type: 'CHECK_IN', contractId: 'c1', inspectorName: '管家' }), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/inspections').send({ type: 'CHECK_IN', contractId: 'c1', inspectorName: '管家' }), 'ADMIN').expect(201);

      // 租客本人端点 /inspections/my 与 /inspections/:id 允许访问
      await as(request(app.getHttpServer()).get('/inspections/my'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).get('/inspections/insp-1'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).post('/inspections/insp-1/confirm').send({ agree: true }), 'TENANT', 'tenant-self').expect(201);
    });

    it('退租申请：租客可发起/查看本人/撤回，管理员审批与全量查询，CLEANER 403', async () => {
      await request(app.getHttpServer()).get('/checkout/requests').expect(401);
      await as(request(app.getHttpServer()).get('/checkout/requests'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/checkout/requests'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/checkout/requests'), 'ADMIN').expect(200);

      // 租客发起退租申请
      await as(request(app.getHttpServer()).post('/checkout/requests').send({ contractId: 'c1', expectedCheckoutDate: '2026-12-01' }), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).post('/checkout/requests').send({ contractId: 'c1', expectedCheckoutDate: '2026-12-01' }), 'TENANT', 'tenant-self').expect(201);

      // 租客查看本人申请与撤回
      await as(request(app.getHttpServer()).get('/checkout/requests/my'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).post('/checkout/requests/req-1/cancel'), 'TENANT', 'tenant-self').expect(201);

      // 管理员审批
      await as(request(app.getHttpServer()).post('/checkout/requests/req-1/review').send({ approved: true }), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/checkout/requests/req-1/review').send({ approved: true }), 'ADMIN').expect(201);
    });
  });

  describe('合同续约意向与报价（LSE-04 / T301）', () => {
    it('续约意向与报价：全量与发起报价未登录 401，TENANT 仅能查看与答复本人报价及填报意向，ADMIN 可全量管理', async () => {
      // 报价列表全量与到期/滞留监控
      await request(app.getHttpServer()).get('/contracts/expiring').expect(401);
      await as(request(app.getHttpServer()).get('/contracts/expiring'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/contracts/expiring'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/contracts/expiring'), 'ADMIN').expect(200);

      await as(request(app.getHttpServer()).get('/contracts/holdover'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/contracts/holdover'), 'ADMIN').expect(200);

      await as(request(app.getHttpServer()).get('/contracts/renewal-offers'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/contracts/renewal-offers'), 'ADMIN').expect(200);

      // 发起报价仅管理员
      await as(request(app.getHttpServer()).post('/contracts/c1/renewal-offers').send({ offeredRent: 300000, offeredDeposit: 300000, startDate: '2026-11-01', endDate: '2027-10-31' }), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/contracts/c1/renewal-offers').send({ offeredRent: 300000, offeredDeposit: 300000, startDate: '2026-11-01', endDate: '2027-10-31' }), 'ADMIN').expect(201);

      // 租客本人端点 /contracts/renewal-offers/my 与 /contracts/renewal-offers/:id/respond 允许访问
      await as(request(app.getHttpServer()).get('/contracts/renewal-offers/my'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).post('/contracts/renewal-offers/ro-1/respond').send({ agree: true }), 'TENANT', 'tenant-self').expect(201);
      await as(request(app.getHttpServer()).post('/contracts/renewal-offers/ro-1/respond').send({ agree: true }), 'CLEANER').expect(403);

      // 租客填报续约意向
      await as(request(app.getHttpServer()).post('/contracts/c1/renewal-intent').send({ intent: 'RENEW' }), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).post('/contracts/c1/renewal-intent').send({ intent: 'RENEW' }), 'TENANT', 'tenant-self').expect(201);
      await as(request(app.getHttpServer()).get('/contracts/c1/renewal-intent'), 'TENANT', 'tenant-self').expect(200);
      await as(request(app.getHttpServer()).get('/contracts/renewal-intents'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/contracts/renewal-intents'), 'ADMIN').expect(200);
    });
  });

  describe('员工管理与负责楼栋范围（WRK-01 / T302）', () => {
    it('员工管理全量接口：未登录 401，TENANT / CLEANER 403，仅 ADMIN 可操作', async () => {
      await request(app.getHttpServer()).get('/staff').expect(401);
      await as(request(app.getHttpServer()).get('/staff'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/staff'), 'CLEANER').expect(403);
      await as(request(app.getHttpServer()).get('/staff'), 'ADMIN').expect(200);

      await as(request(app.getHttpServer()).post('/staff').send({ email: 'pm@example.com', role: 'PROPERTY_MANAGER' }), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/staff').send({ email: 'pm@example.com', role: 'PROPERTY_MANAGER' }), 'ADMIN').expect(201);

      await as(request(app.getHttpServer()).get('/staff/s1'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/staff/s1'), 'ADMIN').expect(200);

      await as(request(app.getHttpServer()).post('/staff/s1/buildings').send({ buildingIds: ['b1'] }), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).post('/staff/s1/buildings').send({ buildingIds: ['b1'] }), 'ADMIN').expect(201);
    });

    it('员工端 /staff/me/buildings：租客 403，员工角色（保洁/管家/ADMIN）允许查看管辖楼栋', async () => {
      await request(app.getHttpServer()).get('/staff/me/buildings').expect(401);
      await as(request(app.getHttpServer()).get('/staff/me/buildings'), 'TENANT').expect(403);
      await as(request(app.getHttpServer()).get('/staff/me/buildings'), 'CLEANER').expect(200);
      await as(request(app.getHttpServer()).get('/staff/me/buildings'), 'ADMIN').expect(200);
    });
  });

  describe('ADMIN 正常可用（回归）', () => {
    it('GET /tenants → 200', async () => {
      await as(request(app.getHttpServer()).get('/tenants'), 'ADMIN').expect(200);
    });

    it('GET /checkout → 200 且走全量查询', async () => {
      await as(request(app.getHttpServer()).get('/checkout'), 'ADMIN').expect(200);
      expect(checkoutService.findAll).toHaveBeenCalled();
    });

    it('POST /auth/invite-codes → 201 并返回邀请码（BUG-2）', async () => {
      const res = await as(request(app.getHttpServer()).post('/auth/invite-codes').send({ expiryDays: 30 }), 'ADMIN').expect(201);

      expect(res.body.inviteCode).toBe('INVITE-generated');
      expect(res.body.expiryDays).toBe(30);
    });
  });
});

describe('房源接口角色隔离（T148，真实 RoomsService）', () => {
  let app: INestApplication;
  let prisma: any;

  beforeAll(async () => {
    prisma = {
      room: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      contract: { findFirst: vi.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { create: vi.fn() } },
        { provide: BusinessClock, useValue: new BusinessClock(new ConfigService({ NODE_ENV: 'test' })) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /rooms/:id 保洁访问非待清洁房间 → 403', async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: 'room-o1',
      status: 'OCCUPIED',
      cleanStatus: 'CLEAN',
    });

    await as(request(app.getHttpServer()).get('/rooms/room-o1'), 'CLEANER').expect(403);
  });

  it('GET /rooms/:id 保洁访问待清洁房间 → 200', async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: 'room-c1',
      status: 'VACANT',
      cleanStatus: 'PENDING_CLEAN',
    });

    await as(request(app.getHttpServer()).get('/rooms/room-c1'), 'CLEANER').expect(200);
  });

  it('GET /rooms 保洁列表：服务端固定只查待清洁/清洁中', async () => {
    prisma.room.findMany.mockClear();

    await as(request(app.getHttpServer()).get('/rooms?status=OCCUPIED'), 'CLEANER').expect(200);

    expect(prisma.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'VACANT',
          cleanStatus: { in: ['PENDING_CLEAN', 'CLEANING'] },
        }),
      }),
    );
  });

  it('GET /rooms/:id 租客访问他人房间 → 403', async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: 'room-t1',
      status: 'OCCUPIED',
      cleanStatus: 'CLEAN',
    });
    prisma.contract.findFirst.mockResolvedValue(null);

    await as(request(app.getHttpServer()).get('/rooms/room-t1'), 'TENANT', 'tenant-self').expect(403);
  });

  it('GET /rooms/:id 租客访问自己租住的房间 → 200', async () => {
    prisma.room.findUnique.mockResolvedValue({
      id: 'room-t1',
      status: 'OCCUPIED',
      cleanStatus: 'CLEAN',
    });
    prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });

    await as(request(app.getHttpServer()).get('/rooms/room-t1'), 'TENANT', 'tenant-self').expect(200);

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { roomId: 'room-t1', tenantId: 'tenant-self' },
      select: { id: true },
    });
  });
});

describe('空间与楼层平面授权（T226）', () => {
  let app: INestApplication;
  const spaceService = {
    getBuildingSpace: vi.fn(async (_id: string, role: string, tenantId?: string) => ({
      view: role,
      floors: [{ floor: 1, rooms: role === 'TENANT' ? (tenantId ? [{ id: 'mine', roomNumber: '101' }] : []) : [{ id: 'mine', roomNumber: '101', ...(role === 'ADMIN' ? { tenantName: '租客甲', lease: { rentAmount: 1000 } } : {}) }] }],
    })),
  };
  const floorPlansService = { findAll: vi.fn().mockResolvedValue([]), save: vi.fn().mockResolvedValue({}) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SpaceController, FloorPlansController],
      providers: [
        { provide: SpaceService, useValue: spaceService },
        { provide: FloorPlansService, useValue: floorPlansService },
      ],
    }).overrideGuard(JwtAuthGuard).useValue(fakeJwtGuard).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  describe('GET /buildings/:id/space', () => {
    it('ADMIN 200；CLEANER 200 且無租客／合約資料', async () => {
      await as(request(app.getHttpServer()).get('/buildings/b1/space'), 'ADMIN').expect(200);
      const cleaner = await as(request(app.getHttpServer()).get('/buildings/b1/space'), 'CLEANER').expect(200);
      expect(JSON.stringify(cleaner.body)).not.toMatch(/tenantName|lease/);
    });

    it('TENANT 只取得自己房間；無租客檔案為空範圍', async () => {
      const own = await as(request(app.getHttpServer()).get('/buildings/b1/space'), 'TENANT', 'tenant-self').expect(200);
      expect(own.body.floors.flatMap((floor: any) => floor.rooms).map((room: any) => room.id)).toEqual(['mine']);
      expect(spaceService.getBuildingSpace).toHaveBeenLastCalledWith('b1', 'TENANT', 'tenant-self');
      const noProfile = await request(app.getHttpServer()).get('/buildings/b1/space').set('x-test-role', 'TENANT').set('x-test-tenant', '').expect(200);
      expect(noProfile.body.floors.flatMap((floor: any) => floor.rooms)).toEqual([]);
      expect(spaceService.getBuildingSpace).toHaveBeenLastCalledWith('b1', 'TENANT', '');
    });

    it('未登入 401', async () => { await request(app.getHttpServer()).get('/buildings/b1/space').expect(401); });
  });

  describe('floor-plans 管理權限', () => {
    it('GET 管理平面圖：ADMIN 200，CLEANER/TENANT 403，未登入 401', async () => {
      await as(request(app.getHttpServer()).get('/buildings/b1/floor-plans'), 'ADMIN').expect(200);
      for (const role of ['CLEANER', 'TENANT']) await as(request(app.getHttpServer()).get('/buildings/b1/floor-plans'), role).expect(403);
      await request(app.getHttpServer()).get('/buildings/b1/floor-plans').expect(401);
    });

    it('PUT 非管理角色不得編輯', async () => {
      for (const role of ['CLEANER', 'TENANT']) {
        await as(request(app.getHttpServer()).put('/buildings/b1/floor-plans/1').send({}), role).expect(403);
      }
    });
  });
});
