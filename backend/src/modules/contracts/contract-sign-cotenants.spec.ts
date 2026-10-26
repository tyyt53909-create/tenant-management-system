import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractsService } from './contracts.service.js';
import { SchedulerMonthlyBillsService } from '../scheduler/scheduler-monthly-bills.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { ContractTemplatesService } from './contract-templates.service.js';
import { ELECTRONIC_SIGN_PROVIDER } from './sign/electronic-sign-provider.interface.js';
import { MockElectronicSignProvider } from './sign/mock-electronic-sign.provider.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('ContractsService: 共同承租人、合同 PDF 与电子签约（T299 / LSE-02）', () => {
  let service: ContractsService;
  let prisma: any;
  let signProvider: MockElectronicSignProvider;
  let notificationsService: any;

  beforeEach(async () => {
    signProvider = new MockElectronicSignProvider();
    const prismaMock: any = {
      contract: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      contractCoTenant: {
        create: vi.fn(),
        findFirst: vi.fn(),
        delete: vi.fn(),
        updateMany: vi.fn(),
      },
      contractAttachment: {
        create: vi.fn().mockResolvedValue({ id: 'att-1' }),
      },
      building: { findUnique: vi.fn() },
      room: { findUnique: vi.fn(), update: vi.fn() },
      tenant: { findUnique: vi.fn() },
    };

    notificationsService = {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SchedulerMonthlyBillsService, useValue: { issueDueRentBills: vi.fn() } },
        {
          provide: SettingsService,
          useValue: {
            getValue: vi.fn().mockResolvedValue({}),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            encrypt: vi.fn((s: string) => `enc:${s}`),
            decrypt: vi.fn((s: string) => s.replace('enc:', '')),
            maskStored: vi.fn(() => '1101********0001'),
          },
        },
        {
          provide: ContractTemplatesService,
          useValue: {
            findDefault: vi.fn().mockResolvedValue({
              id: 'tmpl-1',
              name: '默认模板',
              content: '合同正文：{tenantName} 租住 {roomNumber}，月租 {rentAmountYuan} 元。',
            }),
            render: vi.fn((c: string, vars: Record<string, any>) =>
              `合同正文：${vars.tenantName} 租住 ${vars.roomNumber}，月租 ${vars.rentAmountYuan} 元。`,
            ),
          },
        },
        {
          provide: ELECTRONIC_SIGN_PROVIDER,
          useValue: signProvider,
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: 'test-secret-at-least-32-bytes-long' }),
        },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    prisma = prismaMock;
  });

  describe('共同承租人管理', () => {
    it('addCoTenant：加密身份证号并安全添加共同承租人', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.contractCoTenant.create.mockResolvedValue({
        id: 'cot-1',
        contractId: 'c1',
        name: '合租李四',
        phone: '13800000002',
        idNumber: 'enc:110101199001010001',
        relationship: '同事',
        isSigner: true,
      });

      const res = await service.addCoTenant('c1', {
        name: '合租李四',
        phone: '13800000002',
        idNumber: '110101199001010001',
        relationship: '同事',
        isSigner: true,
      });

      expect(res.id).toBe('cot-1');
      expect(res.idNumber).toBeUndefined(); // 明文必须被隐藏
      expect(res.idNumberMasked).toBe('1101********0001');
      expect(prisma.contractCoTenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: '合租李四',
            idNumber: 'enc:110101199001010001',
            isSigner: true,
          }),
        }),
      );
    });

    it('removeCoTenant：成功移除共同承租人', async () => {
      prisma.contractCoTenant.findFirst.mockResolvedValue({ id: 'cot-1', contractId: 'c1' });
      prisma.contractCoTenant.delete.mockResolvedValue({ id: 'cot-1' });

      const res = await service.removeCoTenant('c1', 'cot-1');
      expect(res.success).toBe(true);
      expect(prisma.contractCoTenant.delete).toHaveBeenCalledWith({ where: { id: 'cot-1' } });
    });
  });

  describe('generatePdf', () => {
    it('生成符合标准的 PDF 1.4 Buffer', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        contractNumber: 'C100001',
        status: 'ACTIVE',
        signStatus: 'SIGNED',
        signFlowId: 'flow-123',
        signedAt: new Date('2026-10-01'),
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-09-30'),
        rentAmount: 300000,
        depositAmount: 300000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        building: { name: '栖居青年公寓', address: '高新一路 8 号' },
        room: { roomNumber: '601', roomType: 'ONE_BED', area: 36.5 },
        tenant: { name: '王承租', phone: '13911112222' },
        coTenants: [{ name: '李合租', phone: '13933334444', relationship: '配偶', isSigner: true }],
      });

      const pdfBuffer = await service.generatePdf('c1', 'tenant-1', 'ADMIN');
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      const str = pdfBuffer.toString('utf-8');
      expect(str.startsWith('%PDF-1.4')).toBe(true);
      expect(str).toContain('C100001');
      expect(str).toContain('601');
    });

    it('租客跨权下载他人合同抛出 403', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        tenantId: 'other-tenant',
        building: { name: '楼' },
        room: { roomNumber: '101' },
        tenant: { name: '张' },
      });

      await expect(service.generatePdf('c1', 'my-tenant', 'TENANT')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('电子签约全流程', () => {
    it('initiateSignFlow：发起签约流程并更新 signStatus=SIGNING', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        contractNumber: 'C2026102601',
        status: 'DRAFT',
        signStatus: 'UNSIGNED',
        building: { name: 'A栋' },
        room: { roomNumber: '202' },
        tenant: { name: '张三', phone: '13812345678', userId: 'user-t1' },
        coTenants: [{ name: '李四', phone: '13912345678', isSigner: true }],
      });
      prisma.contract.update.mockResolvedValue({
        id: 'c1',
        signStatus: 'SIGNING',
      });

      const res = await service.initiateSignFlow('c1', 'admin-1');

      expect(res.contractId).toBe('c1');
      expect(res.signStatus).toBe('SIGNING');
      expect(res.flowId).toContain('ESIGN_C2026102601');
      expect(res.signUrl).toContain('flowId=');
      expect(notificationsService.create).toHaveBeenCalled();
    });

    it('已签约合谋重复发起抛出 ConflictException', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'ACTIVE',
        signStatus: 'SIGNED',
      });

      await expect(service.initiateSignFlow('c1', 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('mockCompleteSign：模拟完成签署，更新状态并归档至附件', async () => {
      const flowId = 'ESIGN_FLOW_999';
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        contractNumber: 'C2026102601',
        signFlowId: flowId,
        tenant: { name: '张三', userId: 'u1' },
        coTenants: [],
      });
      prisma.contract.update.mockResolvedValue({
        id: 'c1',
        signStatus: 'SIGNED',
        signedAt: new Date(),
        signDocUrl: `/api/public/files/signed-${flowId}.pdf`,
      });

      const res = await service.mockCompleteSign('c1');

      expect(res?.signStatus).toBe('SIGNED');
      expect(prisma.contractAttachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'c1',
            type: 'CONTRACT_SCAN',
          }),
        }),
      );
    });

    it('handleSignCallback：接收第三方签署完成通知并自动标记', async () => {
      const flowId = 'ESIGN_CALLBACK_001';
      prisma.contract.findFirst.mockResolvedValue({
        id: 'c1',
        signFlowId: flowId,
        contractNumber: 'C-CALLBACK',
        tenant: { userId: 'u1' },
        coTenants: [],
      });
      prisma.contract.findUnique.mockResolvedValue({
        id: 'c1',
        contractNumber: 'C-CALLBACK',
        tenant: { userId: 'u1' },
        coTenants: [],
      });
      prisma.contract.update.mockResolvedValue({
        id: 'c1',
        signStatus: 'SIGNED',
      });

      const res = await service.handleSignCallback({
        flowId,
        status: 'SIGNED',
      });

      expect(res.success).toBe(true);
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ signStatus: 'SIGNED' }),
        }),
      );
    });
  });
});
