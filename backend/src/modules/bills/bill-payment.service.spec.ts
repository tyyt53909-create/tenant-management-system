import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillPaymentService } from './bill-payment.service.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';

import { AuditLogService } from '../audit/audit-log.service.js';

describe('BillPaymentService', () => {
  let service: BillPaymentService;
  let prisma: any;
  const bill = (overrides: any = {}) => ({ id: 'b1', amount: 1000, paidAmount: 0, status: 'PENDING', ...overrides });

  beforeEach(async () => {
    prisma = {
      bill: { findUnique: vi.fn(), update: vi.fn() },
      lateFee: { findMany: vi.fn(), update: vi.fn() },
      paymentRecord: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    prisma.lateFee.findMany.mockResolvedValue([]);
    prisma.paymentRecord.create.mockResolvedValue({ id: 'p1' });
    prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));
    const module = await Test.createTestingModule({
      providers: [
        BillPaymentService,
        { provide: PrismaService, useValue: prisma },
        // QLT-02 / T288：依赖改为必填后，测试显式提供支付通道与业务时钟
        { provide: PAYMENT_PROVIDER, useValue: new OfflinePaymentProvider() },
        { provide: BusinessClock, useValue: new BusinessClock(new ConfigService({ NODE_ENV: 'test' })) },
        { provide: AuditLogService, useValue: { recordEvent: vi.fn(), log: vi.fn() } },
      ],
    }).compile();
    service = module.get(BillPaymentService);
  });

  it('rejects absent and immutable bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill({ status: 'PAID' })).mockResolvedValueOnce(bill({ status: 'CANCELLED' }));
    for (let i = 0; i < 3; i++) await expect(service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op')).rejects.toThrow(i ? BadRequestException : NotFoundException);
  });

  it('rejects excess and duplicate transactions', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill());
    await expect(service.addPayment('b1', { amount: 1001, paymentMethod: 'CASH' } as any, 'op')).rejects.toThrow(BadRequestException);
    prisma.paymentRecord.findFirst.mockResolvedValue({ id: 'dup' });
    await expect(service.addPayment('b1', { amount: 100, paymentMethod: 'CASH', transactionNumber: 'x' } as any, 'op')).rejects.toThrow(ConflictException);
  });

  it('collects without a transaction number and records optional date', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill());
    const result = await service.addPayment('b1', { amount: 400, paymentMethod: 'CASH', paidAt: '2026-01-01' } as any, 'op');
    expect(prisma.paymentRecord.findFirst).not.toHaveBeenCalled();
    expect(result.bill.status).toBe('PARTIAL');
    expect(prisma.paymentRecord.create.mock.calls[0][0].data.paidAt).toEqual(new Date('2026-01-01'));
  });

  it('settles multiple fees, skipping zero balances, and reaches PAID', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 900 }));
    prisma.lateFee.findMany.mockResolvedValue([
      { id: 'zero', confirmedAmount: 10, settledAmount: 10 },
      { id: 'fee', confirmedAmount: 200, settledAmount: 0 },
    ]);
    prisma.lateFee.update.mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));
    const result = await service.addPayment('b1', { amount: 300, paymentMethod: 'CASH' } as any, 'op');
    expect(prisma.lateFee.update).toHaveBeenCalledTimes(1);
    expect(result.bill.status).toBe('PAID');
  });

  describe('FIN-05 幂等 / 收据 / 作废冲正', () => {
    it('同一幂等键与金额重放返回原收款，不重复入账', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-existing',
        billId: 'b1',
        amount: 100,
        paymentMethod: 'CASH',
        status: 'CONFIRMED',
      });

      const result = await service.addPayment(
        'b1',
        { amount: 100, paymentMethod: 'CASH', idempotencyKey: 'idem-1' } as any,
        'op',
      );

      expect(result.idempotent).toBe(true);
      expect(result.payment.id).toBe('p-existing');
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('已缴账单的同键重放返回原收款，不是 400', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ status: 'PAID', paidAmount: 1000, amount: 1000 }));
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-paid',
        billId: 'b1',
        amount: 1000,
        paymentMethod: 'WECHAT',
        status: 'CONFIRMED',
      });

      const result = await service.addPayment(
        'b1',
        { amount: 1000, paymentMethod: 'WECHAT', idempotencyKey: 'idem-paid' } as any,
        'op',
      );

      expect(result.idempotent).toBe(true);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('同一幂等键改变支付方式 → 409', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-method',
        billId: 'b1',
        amount: 100,
        paymentMethod: 'CASH',
        status: 'CONFIRMED',
      });

      await expect(
        service.addPayment(
          'b1',
          { amount: 100, paymentMethod: 'WECHAT', idempotencyKey: 'idem-method' } as any,
          'op',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('同一幂等键用于不同金额 → 409', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-existing',
        billId: 'b1',
        amount: 50,
        paymentMethod: 'CASH',
        status: 'CONFIRMED',
      });

      await expect(
        service.addPayment(
          'b1',
          { amount: 100, paymentMethod: 'CASH', idempotencyKey: 'idem-1' } as any,
          'op',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('收据号由数据库序列生成', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ nextval: 42n }]);

      await service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op');

      const created = prisma.paymentRecord.create.mock.calls[0][0].data;
      expect(created.receiptNumber).toMatch(/^R\d{8}000042$/);
      expect(created.billPortion).toBe(100);
      expect(created.status).toBe('CONFIRMED');
    });

    it('行锁失败不再被吞掉', async () => {
      prisma.$queryRaw = vi.fn().mockRejectedValue(new Error('lock timeout'));
      prisma.bill.findUnique.mockResolvedValue(bill());

      await expect(
        service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op'),
      ).rejects.toThrow('lock timeout');
    });

    it('作废收款生成负额冲正并把账单回退', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({ amount: 1000, paidAmount: 400, status: 'PARTIAL' }),
      );
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 400,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 400,
        lateFeePortion: 0,
        lateFeeAllocations: [],
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      const result = await service.voidPayment('b1', 'p1', 'op', '录错金额');

      expect(prisma.paymentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: -400,
          status: 'REVERSAL',
          reversalOfId: 'p1',
          billPortion: -400,
        }),
      });
      expect(prisma.paymentRecord.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'VOIDED', voidReason: '录错金额' }),
      });
      expect(result.bill.paidAmount).toBe(0);
      expect(result.bill.status).toBe('PENDING');
    });

    it('作废时按分配精确回滚滞纳金', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 500 }));
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 300,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 200,
        lateFeePortion: 100,
        lateFeeAllocations: [{ lateFeeId: 'f1', amount: 100 }],
      });
      prisma.lateFee.findUnique = vi.fn().mockResolvedValue({
        id: 'f1',
        confirmedAmount: 200,
        settledAmount: 100,
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      await service.voidPayment('b1', 'p1', 'op', '冲正');

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { settledAmount: 0, settledAt: null, settledBy: null },
      });
    });

    it('作废：已取消账单/收款不存在/冲正记录分别拒绝', async () => {
      prisma.bill.findUnique.mockResolvedValueOnce(bill({ status: 'CANCELLED' }));
      await expect(service.voidPayment('b1', 'p1', 'op', 'x')).rejects.toThrow(BadRequestException);

      prisma.bill.findUnique.mockResolvedValueOnce(bill());
      prisma.paymentRecord.findUnique.mockResolvedValueOnce(null);
      await expect(service.voidPayment('b1', 'p1', 'op', 'x')).rejects.toThrow(NotFoundException);

      prisma.bill.findUnique.mockResolvedValueOnce(bill());
      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        billId: 'other',
        status: 'CONFIRMED',
      });
      await expect(service.voidPayment('b1', 'p1', 'op', 'x')).rejects.toThrow(NotFoundException);

      prisma.bill.findUnique.mockResolvedValueOnce(bill());
      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        billId: 'b1',
        status: 'REVERSAL',
      });
      await expect(service.voidPayment('b1', 'p1', 'op', 'x')).rejects.toThrow(ConflictException);
    });

    it('作废后账单回退到 PENDING 并保留 isOverdue（已过期且全额回退）', async () => {
      const past = new Date('2020-01-01');
      prisma.bill.findUnique.mockResolvedValue(
        bill({ amount: 1000, paidAmount: 400, status: 'PARTIAL', dueDate: past }),
      );
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 400,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 400,
        lateFeePortion: 0,
        lateFeeAllocations: [],
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      const result = await service.voidPayment('b1', 'p1', 'op', 'x');
      expect(result.bill.status).toBe('PENDING');
      expect(result.bill.isOverdue).toBe(true);
    });

    it('作废仅滞纳金部分时账单仍为 PAID', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
      );
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 100,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 0,
        lateFeePortion: 100,
        lateFeeAllocations: [{ lateFeeId: 'missing', amount: 100 }],
      });
      prisma.lateFee.findUnique = vi.fn().mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      const result = await service.voidPayment('b1', 'p1', 'op', 'x');
      expect(result.bill.paidAmount).toBe(1000);
      expect(result.bill.status).toBe('PAID');
    });

    it('滞纳金部分回滚后仍未结清时保留已完成标记', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ amount: 1000, paidAmount: 500 }));
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 100,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 0,
        lateFeePortion: 100,
        lateFeeAllocations: [{ lateFeeId: 'f1', amount: 100 }],
      });
      prisma.lateFee.findUnique = vi.fn().mockResolvedValue({
        id: 'f1',
        confirmedAmount: 200,
        settledAmount: 300,
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      await service.voidPayment('b1', 'p1', 'op', 'x');
      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { settledAmount: 200 },
      });
    });

    it('非 P2002 的数据库异常原样上抛', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op'),
      ).rejects.toThrow('db down');
    });

    it('序列返回 0 时不生成收据号', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ nextval: 0 }]);

      await service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op');
      expect(prisma.paymentRecord.create.mock.calls[0][0].data.receiptNumber).toBeNull();
    });

    it('幂等键对应记录已作废时拒绝重放', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-old',
        billId: 'b1',
        amount: 100,
        status: 'VOIDED',
      });

      await expect(
        service.addPayment(
          'b1',
          { amount: 100, paymentMethod: 'CASH', idempotencyKey: 'idem-old' } as any,
          'op',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('历史收款无滞纳金分配时按空数组回退', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ amount: 1000, paidAmount: 500 }));
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 200,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 200,
        lateFeePortion: 0,
        lateFeeAllocations: null,
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      const result = await service.voidPayment('b1', 'p1', 'op', 'x');
      expect(result.bill.paidAmount).toBe(300);
      expect(result.bill.status).toBe('PARTIAL');
      expect(prisma.lateFee.update).not.toHaveBeenCalled();
    });

    it('滞纳金金额字段为空时按 0 处理', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'empty', confirmedAmount: null, settledAmount: null },
      ]);
      prisma.lateFee.update.mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));

      const result = await service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op');
      expect(prisma.lateFee.update).not.toHaveBeenCalled();
      expect(result.bill.status).toBe('PARTIAL');
    });

    it('滞纳金只核销一部分时保留未结清状态', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({ amount: 1000, paidAmount: 900, status: 'PARTIAL' }),
      );
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'fee', confirmedAmount: 500, settledAmount: 0 },
      ]);
      prisma.lateFee.update.mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));

      const result = await service.addPayment(
        'b1',
        { amount: 200, paymentMethod: 'CASH' } as any,
        'op',
      );

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'fee' },
        data: { settledAmount: 100 },
      });
      expect(result.bill.status).toBe('PARTIAL');
    });

    it('序列返回非数组结果时收据号为空', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ nextval: 5 });

      await service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op');
      expect(prisma.paymentRecord.create.mock.calls[0][0].data.receiptNumber).toBeNull();
    });

    it('数据库唯一约束冲突（P2002）映射为 409', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      await expect(
        service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op'),
      ).rejects.toThrow(ConflictException);
    });

    it('重复作废幂等返回已有冲正', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 0 }));
      prisma.paymentRecord.findUnique
        .mockResolvedValueOnce({ id: 'p1', billId: 'b1', status: 'VOIDED' })
        .mockResolvedValueOnce({ id: 'rev1', reversalOfId: 'p1' });

      const result = await service.voidPayment('b1', 'p1', 'op', 'again');

      expect(result.idempotent).toBe(true);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });
  });

  it('finds payment history and rejects unknown bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill());
    await expect(service.findPayments('b1')).rejects.toThrow(NotFoundException);
    prisma.paymentRecord.findMany.mockResolvedValue([]);
    expect(await service.findPayments('b1')).toEqual([]);
  });
});
