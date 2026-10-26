import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractTemplatesService } from './contract-templates.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ContractTemplatesService', () => {
  let service: ContractTemplatesService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      contractTemplate: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      contract: {
        count: vi.fn(),
      },
    };
    prismaMock.$transaction = vi.fn(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractTemplatesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ContractTemplatesService>(ContractTemplatesService);
    prisma = prismaMock;
  });

  describe('ensureDefaultTemplate & findDefault', () => {
    it('当数据库无默认模板时，自动创建标准住宅租赁合同模板', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValue(null);
      prisma.contractTemplate.create.mockResolvedValue({
        id: 'tmpl-default',
        code: 'STANDARD_RESIDENTIAL',
        name: '标准住宅租赁合同模板',
        isDefault: true,
      });

      const res = await service.findDefault();
      expect(res.code).toBe('STANDARD_RESIDENTIAL');
      expect(prisma.contractTemplate.create).toHaveBeenCalled();
    });

    it('存在默认模板时直接返回', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValue({
        id: 'tmpl-1',
        code: 'STANDARD_RESIDENTIAL',
        isDefault: true,
      });

      const res = await service.findDefault();
      expect(res.id).toBe('tmpl-1');
    });
  });

  describe('create & update', () => {
    it('创建编码重复时抛出 ConflictException', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue({ id: 'tmpl-1', code: 'DUP' });

      await expect(
        service.create({ name: '重名', code: 'DUP', content: '内容' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('成功创建模板，若标记为 isDefault 则取消原默认模板', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(null);
      prisma.contractTemplate.create.mockResolvedValue({ id: 'tmpl-new', isDefault: true });

      const res = await service.create(
        { name: '新模板', code: 'NEW_CODE', content: '条款', isDefault: true },
        'admin-1',
      );
      expect(res.id).toBe('tmpl-new');
      expect(prisma.contractTemplate.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('remove', () => {
    it('默认模板不可删除', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue({ id: 't1', isDefault: true });

      await expect(service.remove('t1')).rejects.toThrow(ConflictException);
    });

    it('已有合同关联的模板不可删除', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue({ id: 't1', isDefault: false });
      prisma.contract.count.mockResolvedValue(2);

      await expect(service.remove('t1')).rejects.toThrow('已有合同关联该模板');
    });

    it('正常无关联模板可删除', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue({ id: 't1', isDefault: false });
      prisma.contract.count.mockResolvedValue(0);
      prisma.contractTemplate.delete.mockResolvedValue({ id: 't1' });

      const res = await service.remove('t1');
      expect(res.success).toBe(true);
    });
  });

  describe('render', () => {
    it('正确替换所有变量占位符', () => {
      const template = '乙方：{tenantName}，月租：{rentAmountYuan}元，房间：{roomNumber}室。';
      const result = service.render(template, {
        tenantName: '张三',
        rentAmountYuan: '2500.00',
        roomNumber: '101',
      });
      expect(result).toBe('乙方：张三，月租：2500.00元，房间：101室。');
    });
  });
});
