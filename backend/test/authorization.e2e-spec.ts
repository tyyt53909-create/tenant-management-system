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
import { BillsService } from '../src/modules/bills/bills.service.js';
import { BuildingsController } from '../src/modules/buildings/buildings.controller.js';
import { BuildingsService } from '../src/modules/buildings/buildings.service.js';
import { CheckoutController } from '../src/modules/checkout/checkout.controller.js';
import { CheckoutService } from '../src/modules/checkout/checkout.service.js';
import { ContractsController } from '../src/modules/contracts/contracts.controller.js';
import { ContractsService } from '../src/modules/contracts/contracts.service.js';
import { MaintenanceController } from '../src/modules/maintenance/maintenance.controller.js';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service.js';
import { PrepayController } from '../src/modules/prepay/prepay.controller.js';
import { PrepayService } from '../src/modules/prepay/prepay.service.js';
import { MetersController } from '../src/modules/meters/meters.controller.js';
import { MetersService } from '../src/modules/meters/meters.service.js';
import { MetersSimulatorService } from '../src/modules/meters/meters-simulator.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { RoomsController } from '../src/modules/rooms/rooms.controller.js';
import { RoomsService } from '../src/modules/rooms/rooms.service.js';
import { TenantCapabilityService } from '../src/modules/tenant-capabilities/tenant-capability.service.js';
import { TenantsController } from '../src/modules/tenants/tenants.controller.js';
import { TenantsService } from '../src/modules/tenants/tenants.service.js';

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
        TenantsController,
        BillsController,
        ContractsController,
        MaintenanceController,
        CheckoutController,
        BuildingsController,
        MetersController,
        RoomsController,
        AuthController,
        PrepayController,
      ],
      providers: [
        // AuthController 依赖 ConfigService 决定 refresh cookie 的 Secure 标志
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) },
        { provide: TenantsService, useValue: tenantsService },
        { provide: BillsService, useValue: billsService },
        { provide: CheckoutService, useValue: checkoutService },
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
            create: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
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
