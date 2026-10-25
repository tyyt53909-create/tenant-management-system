import { Test, TestingModule } from '@nestjs/testing';
import { BillsService, summarizeLateFees } from '../bills.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BillPaymentService } from '../bill-payment.service.js';
import { BillLateFeeService } from '../bill-late-fee.service.js';
import { BillReceiptService } from '../bill-receipt.service.js';
import { OfflinePaymentProvider } from '../payment/offline-payment.provider.js';
import { BusinessClock } from '../../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';

describe('summarizeLateFees（列表滞纳金摘要，T157）', () => {
  it('无记录 → none / amount 为 null', () => {
    expect(summarizeLateFees([])).toEqual({
      count: 0,
      status: 'none',
      amount: null,
      suggestedAmount: 0,
      settledAmount: 0,
      pendingSettled: 0,
      overdueDays: 0,
    });
  });

  it('仅建议值（未确认）→ suggested，amount 仍为 null', () => {
    const res = summarizeLateFees([
      {
        suggestedAmount: 2700,
        confirmedAmount: null,
        settledAmount: null,
        overdueDays: 9,
        confirmedAt: null,
        settledAt: null,
      },
    ]);
    expect(res.status).toBe('suggested');
    expect(res.amount).toBeNull();
    expect(res.suggestedAmount).toBe(2700);
    expect(res.overdueDays).toBe(9);
  });

  it('已确认未结清 → confirmed，pendingSettled = 确认额', () => {
    const res = summarizeLateFees([
      {
        suggestedAmount: 2700,
        confirmedAmount: 2500,
        settledAmount: null,
        overdueDays: 9,
        confirmedAt: new Date('2026-10-13'),
        settledAt: null,
      },
    ]);
    expect(res.status).toBe('confirmed');
    expect(res.amount).toBe(2500);
    expect(res.pendingSettled).toBe(2500);
    expect(res.settledAmount).toBe(0);
  });

  it('部分核销 → confirmed，pendingSettled 为差额', () => {
    const res = summarizeLateFees([
      {
        suggestedAmount: 2700,
        confirmedAmount: 2500,
        settledAmount: 1000,
        overdueDays: 9,
        confirmedAt: new Date('2026-10-13'),
        settledAt: null,
      },
    ]);
    expect(res.status).toBe('confirmed');
    expect(res.settledAmount).toBe(1000);
    expect(res.pendingSettled).toBe(1500);
  });

  it('已结清 → settled', () => {
    const res = summarizeLateFees([
      {
        suggestedAmount: 2700,
        confirmedAmount: 2500,
        settledAmount: 2500,
        overdueDays: 9,
        confirmedAt: new Date('2026-10-13'),
        settledAt: new Date('2026-10-14'),
      },
    ]);
    expect(res.status).toBe('settled');
    expect(res.pendingSettled).toBe(0);
  });

  it('多条记录：已确认额与已核销额分别累加，建议值取最新一条', () => {
    const res = summarizeLateFees([
      {
        suggestedAmount: 900,
        confirmedAmount: 800,
        settledAmount: 800,
        overdueDays: 12,
        confirmedAt: new Date('2026-10-13'),
        settledAt: new Date('2026-10-13'),
      },
      {
        suggestedAmount: 500,
        confirmedAmount: null,
        settledAmount: null,
        overdueDays: 5,
        confirmedAt: null,
        settledAt: null,
      },
    ]);
    expect(res.count).toBe(2);
    // 最新一条（下标 0）为建议值来源
    expect(res.suggestedAmount).toBe(900);
    expect(res.amount).toBe(800);
    expect(res.settledAmount).toBe(800);
    expect(res.status).toBe('settled');
  });
});

describe('BillsService.findAll（T157 附滞纳金摘要，消除 N+1）', () => {
  let service: BillsService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = {
      bill: { findMany: vi.fn(), count: vi.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillsService,
        { provide: PrismaService, useValue: prismaMock },
        // QLT-02 / T288：依赖必填后显式提供（本用例只测列表摘要，子服务不参与断言）
        {
          provide: BillPaymentService,
          useFactory: () =>
            new BillPaymentService(
              prismaMock as never,
              new OfflinePaymentProvider(),
              new BusinessClock(new ConfigService({ NODE_ENV: 'test' })),
              { recordEvent: vi.fn(), log: vi.fn() } as never,
            ),
        },
        { provide: BillLateFeeService, useFactory: () => new BillLateFeeService(prismaMock as never) },
        { provide: BillReceiptService, useFactory: () => new BillReceiptService(prismaMock as never) },
      ],
    }).compile();
    service = module.get<BillsService>(BillsService);
    prisma = prismaMock;
  });

  it('列表查询 include 中带 lateFees，且响应附带 lateFeeSummary', async () => {
    prisma.bill.findMany.mockResolvedValue([
      {
        id: 'bill-1',
        amount: 100000,
        lateFees: [
          {
            id: 'lf-1',
            suggestedAmount: 2700,
            confirmedAmount: 2500,
            settledAmount: 2500,
            overdueDays: 9,
            confirmedAt: new Date(),
            settledAt: new Date(),
          },
        ],
      },
    ]);
    prisma.bill.count.mockResolvedValue(1);

    const res = await service.findAll({ page: 1, limit: 20 } as any);

    expect(prisma.bill.findMany.mock.calls[0][0].include.lateFees).toBeDefined();
    expect(res.data[0].lateFeeSummary).toMatchObject({
      count: 1,
      status: 'settled',
      amount: 2500,
    });
    // 原始 lateFees 数组不应出现在响应中（只暴露摘要）
    expect((res.data[0] as any).lateFees).toBeUndefined();
  });

  it('无滞纳金时摘要为 none', async () => {
    prisma.bill.findMany.mockResolvedValue([{ id: 'bill-2', amount: 5000, lateFees: [] }]);
    prisma.bill.count.mockResolvedValue(1);

    const res = await service.findAll({ page: 1, limit: 20 } as any);

    expect(res.data[0].lateFeeSummary.status).toBe('none');
  });
});
