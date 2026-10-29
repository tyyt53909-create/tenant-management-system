import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { BillPaymentService } from './bill-payment.service.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER } from './payment/payment-provider.js';
import { OfflinePaymentProvider } from './payment/offline-payment.provider.js';

import { AuditLogService } from '../audit/audit-log.service.js';
import { PrepayService } from '../prepay/prepay.service.js';

describe('BillPaymentService', () => {
  let service: BillPaymentService;
  let prisma: any;
  const bill = (overrides: any = {}) => ({ id: 'b1', amount: 1000, paidAmount: 0, status: 'PENDING', ...overrides });

  beforeEach(async () => {
    prisma = {
      bill: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
      lateFee: { findMany: vi.fn(), update: vi.fn() },
      paymentRecord: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        update: vi.fn(),
      },
      refundRecord: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          const payment = await prisma.paymentRecord.findUnique.mock.results.at(-1)?.value;
          const amounts: Record<string, number> = { RF_FULL_001: 1000, RF_PART_001: 300, RF_FEE_001: 500, RF_FEE_002: 500, RF_FEE_003: 500, RF_OVER_001: 200, RF_NO_ALLOC: 500 };
          return { id: 'refund-1', billId: payment?.billId, paymentRecordId: payment?.id, amount: amounts[where.outRefundNo], status: 'PROCESSING', reversal: null };
        }),
        update: vi.fn(),
      },
      prepayAccount: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
      },
      prepayTransaction: {
        create: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    prisma.bill.findUniqueOrThrow.mockImplementation(async () => await prisma.bill.findUnique.mock.results.at(-1)?.value);
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
        {
          provide: PrepayService,
          useValue: { triggerLowBalanceAlertIfNeeded: vi.fn().mockResolvedValue(true) },
        },
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

    describe('applyRefundReversal (T294 / PAY-02)', () => {
      it('账单不存在抛出 NotFoundException', async () => {
        prisma.bill.findUnique.mockResolvedValue(null);
        await expect(
          service.applyRefundReversal({
            billId: 'b-none',
            paymentId: 'p1',
            refundAmount: 100,
            outRefundNo: 'RF_1',
            operatorId: 'op1',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('收款记录不存在或属于其他账单抛出 NotFoundException', async () => {
        prisma.bill.findUnique.mockResolvedValue(bill());
        prisma.paymentRecord.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'p1',
          billId: 'other-bill',
        });

        await expect(
          service.applyRefundReversal({
            billId: 'b1',
            paymentId: 'p1',
            refundAmount: 100,
            outRefundNo: 'RF_1',
            operatorId: 'op1',
          }),
        ).rejects.toThrow(NotFoundException);

        await expect(
          service.applyRefundReversal({
            billId: 'b1',
            paymentId: 'p1',
            refundAmount: 100,
            outRefundNo: 'RF_1',
            operatorId: 'op1',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('全额退款：生成负额冲正、原单标记 VOIDED、账单回退为 PENDING', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-full',
          billId: 'b1',
          amount: 1000,
          paymentMethod: 'WECHAT',
          billPortion: 1000,
          lateFeePortion: 0,
          lateFeeAllocations: [],
          status: 'CONFIRMED',
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-full', amount: -1000 });
        prisma.paymentRecord.update.mockResolvedValue({ id: 'p-full', status: 'VOIDED' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        const result = await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-full',
          refundAmount: 1000,
          outRefundNo: 'RF_FULL_001',
          refundId: 'WX_REF_001',
          operatorId: 'admin-1',
          reason: '全额退款',
        });

        expect(prisma.paymentRecord.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            billId: 'b1',
            amount: -1000,
            status: 'REVERSAL',
            reversalOfId: 'p-full',
            transactionNumber: 'WX_REF_001',
          }),
        });

        expect(prisma.paymentRecord.update).toHaveBeenCalledWith({
          where: { id: 'p-full' },
          data: expect.objectContaining({
            status: 'VOIDED',
            voidReason: expect.stringContaining('全额退款'),
          }),
        });

        expect(result.bill.paidAmount).toBe(0);
        expect(result.bill.status).toBe('PENDING');
      });

      it('部分退款：原收款保持 CONFIRMED，冲正记录无 reversalOfId，账单仍为 PARTIAL', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-part',
          billId: 'b1',
          amount: 1000,
          paymentMethod: 'WECHAT',
          billPortion: 1000,
          lateFeePortion: 0,
          lateFeeAllocations: [],
          status: 'CONFIRMED',
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-part', amount: -300 });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        const result = await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-part',
          refundAmount: 300,
          outRefundNo: 'RF_PART_001',
          operatorId: 'admin-1',
        });

        expect(prisma.paymentRecord.update).not.toHaveBeenCalled();
        expect(prisma.paymentRecord.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            amount: -300,
            status: 'REVERSAL',
            billPortion: -300,
            lateFeePortion: -0,
          }),
        });
        expect(result.bill.paidAmount).toBe(700);
        expect(result.bill.status).toBe('PARTIAL');
      });

      it('退款含滞纳金回滚：准确按比例回滚滞纳金已结算金额', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-fee',
          billId: 'b1',
          amount: 500,
          paymentMethod: 'WECHAT',
          billPortion: 300,
          lateFeePortion: 200,
          lateFeeAllocations: [
            { lateFeeId: 'fee-1', amount: 150 },
            { lateFeeId: 'fee-not-found', amount: 50 },
          ],
          status: 'CONFIRMED',
        });
        prisma.lateFee.findUnique = vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'fee-1') {
            return Promise.resolve({
              id: 'fee-1',
              confirmedAmount: 150,
              settledAmount: 150,
            });
          }
          return Promise.resolve({ id: 'fee-not-found', confirmedAmount: 50, settledAmount: 50 });
        });

        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-fee' });
        prisma.paymentRecord.update.mockResolvedValue({ id: 'p-fee', status: 'VOIDED' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-fee',
          refundAmount: 500,
          outRefundNo: 'RF_FEE_001',
          operatorId: 'admin-1',
        });

        expect(prisma.lateFee.update).toHaveBeenCalledWith({
          where: { id: 'fee-1' },
          data: {
            settledAmount: 0,
            settledAt: null,
            settledBy: null,
          },
        });
      });

      it('滞纳金回滚后仍满足结清金额时保留已结算状态', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-fee2',
          billId: 'b1',
          amount: 500,
          paymentMethod: 'WECHAT',
          billPortion: 400,
          lateFeePortion: 100,
          lateFeeAllocations: [{ lateFeeId: 'fee-2', amount: 100 }],
          status: 'CONFIRMED',
        });
        prisma.lateFee.findUnique = vi.fn().mockResolvedValue({
          id: 'fee-2',
          confirmedAmount: 50,
          settledAmount: 150,
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-fee2' });
        prisma.paymentRecord.update.mockResolvedValue({ id: 'p-fee2', status: 'VOIDED' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-fee2',
          refundAmount: 500,
          outRefundNo: 'RF_FEE_002',
          operatorId: 'admin-1',
        });

        expect(prisma.lateFee.update).toHaveBeenCalledWith({
          where: { id: 'fee-2' },
          data: {
            settledAmount: 50,
          },
        });
      });

      it('多笔滞纳金分配在满足冲退金额后及时 break', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-fee3',
          billId: 'b1',
          amount: 500,
          paymentMethod: 'WECHAT',
          billPortion: 450,
          lateFeePortion: 50,
          lateFeeAllocations: [
            { lateFeeId: 'fee-a', amount: 50 },
            { lateFeeId: 'fee-b', amount: 50 },
          ],
          status: 'CONFIRMED',
        });
        prisma.lateFee.findUnique = vi.fn().mockResolvedValue({
          id: 'fee-a',
          confirmedAmount: 100,
          settledAmount: 100,
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-fee3' });
        prisma.paymentRecord.update.mockResolvedValue({ id: 'p-fee3', status: 'VOIDED' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-fee3',
          refundAmount: 500,
          outRefundNo: 'RF_FEE_003',
          operatorId: 'admin-1',
        });

        expect(prisma.lateFee.findUnique).toHaveBeenCalledTimes(1);
      });

      it('部分退款后账单实缴仍满足应缴时保持 PAID 状态', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 500, paidAmount: 800, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-over',
          billId: 'b1',
          amount: 800,
          paymentMethod: 'WECHAT',
          billPortion: 800,
          lateFeePortion: 0,
          lateFeeAllocations: null,
          status: 'CONFIRMED',
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-over' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        const result = await service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-over',
          refundAmount: 200,
          outRefundNo: 'RF_OVER_001',
          operatorId: 'admin-1',
        });

        expect(result.bill.paidAmount).toBe(600);
        expect(result.bill.status).toBe('PAID');
        expect(result.bill.isOverdue).toBe(false);
      });

      it('退款含滞纳金但无分配记录时拒绝以免误冲', async () => {
        prisma.bill.findUnique.mockResolvedValue(
          bill({ amount: 1000, paidAmount: 1000, status: 'PAID' }),
        );
        prisma.paymentRecord.findUnique.mockResolvedValue({
          id: 'p-no-alloc',
          billId: 'b1',
          amount: 500,
          paymentMethod: 'WECHAT',
          billPortion: 400,
          lateFeePortion: 100,
          lateFeeAllocations: null,
          status: 'CONFIRMED',
        });
        prisma.paymentRecord.create.mockResolvedValue({ id: 'rev-no-alloc' });
        prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

        await expect(service.applyRefundReversal({
          billId: 'b1',
          paymentId: 'p-no-alloc',
          refundAmount: 500,
          outRefundNo: 'RF_NO_ALLOC',
          operatorId: 'admin-1',
        })).rejects.toThrow('滞纳金分配不足');
        expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
      });
    });
  });

  it('finds payment history and rejects unknown bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill());
    await expect(service.findPayments('b1')).rejects.toThrow(NotFoundException);
    prisma.paymentRecord.findMany.mockResolvedValue([]);
    expect(await service.findPayments('b1')).toEqual([]);
  });

  describe('payWithPrepay (T296 / PAY-04)', () => {
    it('预付账户余额不足时抛出 PREPAY_INSUFFICIENT_BALANCE', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b1',
        amount: 1000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { id: 'c1', tenantId: 't1', roomId: 'r1', tenant: { id: 't1' } },
      });
      prisma.prepayAccount.findUnique.mockResolvedValue({
        id: 'pa1',
        balanceCache: 0,
      });

      await expect(
        service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow();
    });

    it('预付账户余额充足时扣减预付、记流水与收款记录', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b1',
        billNumber: 'B20261026001',
        amount: 1000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { id: 'c1', tenantId: 't1', roomId: 'r1', tenant: { id: 't1' } },
      });
      prisma.prepayAccount.findUnique.mockResolvedValue({
        id: 'pa1',
        balanceCache: 2000,
        lowBalanceThreshold: 500,
      });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({
        id: 'pa1',
        balanceCache: 1000,
      });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'pt1' });

      // 模拟收款入账
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ nextval: 101 }]);
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({
        id: 'pmt-prepay-1',
        billId: 'b1',
        amount: 1000,
        paymentMethod: 'PREPAY',
        receiptNumber: 'R20261026000101',
      });
      prisma.bill.update.mockResolvedValue({ id: 'b1', status: 'PAID', paidAmount: 1000 });

      const res = await service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' });

      expect(res.payment.id).toBe('pmt-prepay-1');
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pa1', balanceCache: { gte: 1000 } },
          data: { balanceCache: { decrement: 1000 } },
        }),
      );
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 'pa1',
            type: 'DEDUCTION',
            amount: -1000,
            relatedType: 'BILL_DEDUCTION',
          }),
        }),
      );
    });

    it('payWithPrepay 各种越权、状态与边界异常分支', async () => {
      // 1. 账单不存在
      prisma.bill.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.payWithPrepay('not-exist', {}, { userId: 'u1', role: 'ADMIN' }),
      ).rejects.toThrow(NotFoundException);

      // 2. 租客端查无 Tenant 档案
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.tenant.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'u1', role: 'TENANT' }),
      ).rejects.toThrow(ForbiddenException);

      // 3. 租客端操作他人账单
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 't-other' });
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'u1', role: 'TENANT' }),
      ).rejects.toThrow(ForbiddenException);

      // 4. 账单已付或已取消
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        status: 'PAID',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);

      // 5. 待缴金额 <= 0
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        amount: 500,
        paidAmount: 500,
        status: 'PENDING',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.lateFee.findMany.mockResolvedValueOnce([]);
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);

      // 6. 预付账户不存在
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        amount: 1000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.prepayAccount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow();

      // 7. 并发条件扣减余额失败 count === 0
      prisma.bill.findUnique.mockResolvedValueOnce({
        id: 'b1',
        billNumber: 'B001',
        amount: 1000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.prepayAccount.findUnique.mockResolvedValueOnce({ id: 'pa1', balanceCache: 1000 });
      prisma.prepayAccount.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.payWithPrepay('b1', {}, { userId: 'admin', role: 'ADMIN' }),
      ).rejects.toThrow();

      // 8. 租客指定部分金额抵扣且成功抵扣
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b1',
        billNumber: 'B002',
        amount: 2000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { tenantId: 't1', roomId: 'r1' },
      });
      prisma.tenant.findUnique.mockResolvedValueOnce({ id: 't1' });
      prisma.prepayAccount.findUnique.mockResolvedValueOnce({ id: 'pa1', balanceCache: 5000 });
      prisma.prepayAccount.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValueOnce({ id: 'pa1', balanceCache: 4500 });
      prisma.prepayTransaction.create.mockResolvedValueOnce({ id: 'pt-part' });
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ nextval: 102 }]);
      prisma.paymentRecord.create.mockResolvedValueOnce({ id: 'pmt-2', amount: 500 });
      prisma.bill.update.mockResolvedValueOnce({ id: 'b1', status: 'PARTIALLY_PAID', paidAmount: 500 });

      const partialRes = await service.payWithPrepay(
        'b1',
        { amount: 500 },
        { userId: 'u1', role: 'TENANT' },
      );
      expect(partialRes.payment.id).toBe('pmt-2');
    });
  });
});
