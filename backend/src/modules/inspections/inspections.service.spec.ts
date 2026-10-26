import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InspectionsService } from './inspections.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('InspectionsService', () => {
  let service: InspectionsService;
  let prisma: any;
  let settings: any;
  let notifications: any;

  beforeEach(async () => {
    const prismaMock: any = {
      contract: {
        findUnique: vi.fn(),
      },
      roomInspection: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      inspectionItem: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };
    prismaMock.$transaction = vi.fn(async (cb: any) => cb(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InspectionsService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: SettingsService,
          useValue: {
            getValue: vi.fn().mockImplementation(async (key: string) => {
              if (key === 'leasing.defaultInspectionItems') {
                return [
                  { name: '门卡钥匙', category: 'KEYS', quantity: 2 },
                  { name: '空调及遥控器', category: 'APPLIANCE', quantity: 1 },
                ];
              }
              return null;
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn().mockResolvedValue({ id: 'n1' }),
          },
        },
      ],
    }).compile();

    service = module.get<InspectionsService>(InspectionsService);
    prisma = prismaMock;
    settings = module.get<SettingsService>(SettingsService);
    notifications = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('当关联合同不存在时抛出 BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            type: 'CHECK_IN',
            contractId: 'c-invalid',
            inspectorName: '张管家',
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('未传物品明细时，自动使用默认设置中心的清单填充并发送租客通知', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        roomId: 'r1',
        tenantId: 't1',
        room: { roomNumber: '502' },
        tenant: { userId: 'u-t1', name: '李租客', phone: '13800000001' },
      });
      prisma.roomInspection.create.mockResolvedValue({
        id: 'insp-1',
        type: 'CHECK_IN',
        status: 'PENDING_CONFIRM',
      });

      const res = await service.create(
        {
          type: 'CHECK_IN',
          contractId: 'c1',
          inspectorName: '张管家',
          meterReadings: { coldWater: 15.2, electric: 200.5 },
        },
        'admin-1',
      );

      expect(res.id).toBe('insp-1');
      expect(prisma.roomInspection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CHECK_IN',
            contractId: 'c1',
            roomId: 'r1',
            tenantId: 't1',
            items: {
              create: expect.arrayContaining([
                expect.objectContaining({ name: '门卡钥匙', quantity: 2 }),
                expect.objectContaining({ name: '空调及遥控器', quantity: 1 }),
              ]),
            },
          }),
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-t1',
          title: expect.stringContaining('入住交付'),
        }),
      );
    });

    it('传入自定义 items 和 inspectedAt 时正常落库', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        roomId: 'r1',
        tenantId: 't1',
        room: { roomNumber: '502' },
        tenant: { userId: null },
      });
      prisma.roomInspection.create.mockResolvedValue({
        id: 'insp-2',
        type: 'CHECK_OUT',
      });

      const res = await service.create(
        {
          type: 'CHECK_OUT',
          contractId: 'c1',
          inspectorName: '李管家',
          inspectedAt: '2026-10-26T10:00:00.000Z',
          items: [{ name: '钥匙', quantity: 1, status: 'INTACT' }],
        },
        'admin-1',
      );

      expect(res.id).toBe('insp-2');
    });
  });

  describe('findAll & findOne', () => {
    it('findAll 支持按参数过滤并正确分页', async () => {
      prisma.roomInspection.findMany.mockResolvedValue([{ id: 'insp-1' }]);
      prisma.roomInspection.count.mockResolvedValue(1);

      const res = await service.findAll({
        type: 'CHECK_IN',
        status: 'PENDING_CONFIRM',
        contractId: 'c1',
        roomId: 'r1',
        tenantId: 't1',
        page: 1,
        limit: 10,
      });

      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it('findOne 找到时返回详情，未找到抛 NotFoundException', async () => {
      prisma.roomInspection.findUnique.mockResolvedValueOnce({ id: 'insp-1' });
      expect((await service.findOne('insp-1')).id).toBe('insp-1');

      prisma.roomInspection.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('insp-none')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('更新验房单基础字段与物品列表', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'DRAFT',
      });
      prisma.roomInspection.update.mockResolvedValue({
        id: 'insp-1',
        inspectorName: '新管家',
      });

      const res = await service.update('insp-1', {
        inspectorName: '新管家',
        inspectorPhone: '13899990000',
        inspectedAt: '2026-10-26T12:00:00.000Z',
        meterReadings: { electric: 120 },
        photos: ['p1.jpg'],
        overallNotes: '备注更新',
        checkoutRecordId: 'rec-1',
        items: [{ name: '新物品', quantity: 1 }],
      });

      expect(res.id).toBe('insp-1');
      expect(prisma.inspectionItem.deleteMany).toHaveBeenCalled();
      expect(prisma.inspectionItem.createMany).toHaveBeenCalled();
    });
  });

  describe('findByTenant & findOneForTenant 租客隔离', () => {
    it('tenantId 缺失时抛出 ForbiddenException', async () => {
      await expect(service.findByTenant('', {} as any)).rejects.toThrow(ForbiddenException);
    });

    it('租客只能查到本人的验房单', async () => {
      prisma.roomInspection.findMany.mockResolvedValue([{ id: 'insp-1' }]);
      prisma.roomInspection.count.mockResolvedValue(1);

      const res = await service.findByTenant('t-mine', {});
      expect(res.data).toHaveLength(1);
      expect(prisma.roomInspection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't-mine' }),
        }),
      );
    });

    it('跨权查看他人验房单抛出 NotFoundException', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-other',
        tenantId: 't-other',
      });

      await expect(service.findOneForTenant('insp-other', 't-mine')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('confirm', () => {
    it('租客确认同意时更新为 CONFIRMED 并记录时间', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        tenantId: 't-mine',
        status: 'PENDING_CONFIRM',
      });
      prisma.roomInspection.update.mockResolvedValue({
        id: 'insp-1',
        status: 'CONFIRMED',
      });

      const res = await service.confirm(
        'insp-1',
        { agree: true, tenantSignature: 'sig-data' },
        't-mine',
        true,
      );

      expect(res.status).toBe('CONFIRMED');
      expect(prisma.roomInspection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            tenantSignature: 'sig-data',
          }),
        }),
      );
    });

    it('租客提出异议时更新为 REJECTED', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        tenantId: 't-mine',
        status: 'PENDING_CONFIRM',
      });
      prisma.roomInspection.update.mockResolvedValue({
        id: 'insp-1',
        status: 'REJECTED',
      });

      const res = await service.confirm(
        'insp-1',
        { agree: false, tenantNotes: '空调遥控器无法开机' },
        't-mine',
        true,
      );

      expect(res.status).toBe('REJECTED');
      expect(prisma.roomInspection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            tenantNotes: '空调遥控器无法开机',
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('已确认生效的验房单禁止删除', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'CONFIRMED',
      });

      await expect(service.remove('insp-1')).rejects.toThrow(ConflictException);
    });

    it('草稿或待确认验房单允许删除', async () => {
      prisma.roomInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'DRAFT',
      });
      prisma.roomInspection.delete.mockResolvedValue({ id: 'insp-1' });

      const res = await service.remove('insp-1');
      expect(res.success).toBe(true);
      expect(prisma.roomInspection.delete).toHaveBeenCalledWith({ where: { id: 'insp-1' } });
    });
  });
});
