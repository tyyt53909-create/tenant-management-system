import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DepositView {
  id: string;
  contractId: string;
  tenantId: string;
  roomId: string;
  amount: number;
  balance: number;
  status: string;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    relatedType: string | null;
    relatedId: string | null;
    operatorId: string;
    notes: string | null;
    createdAt: Date;
  }>;
}

@Injectable()
export class DepositsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 管理端查看押金台账（含流水）。 */
  async getByContract(contractId: string): Promise<DepositView> {
    const ledger = await this.prisma.depositLedger.findUnique({
      where: { contractId },
      include: { transactions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!ledger) throw new NotFoundException('该合同暂无押金台账');
    return ledger;
  }

  /** 租客端查看：必须绑定该租客档案。 */
  async getForTenant(contractId: string, tenantId: string): Promise<DepositView> {
    const ledger = await this.prisma.depositLedger.findUnique({ where: { contractId } });
    if (!ledger || ledger.tenantId !== tenantId) {
      throw new NotFoundException('该合同暂无押金台账');
    }
    return this.getByContract(contractId);
  }

  /** 扣除押金（结算/损坏赔偿）；余额不足 400。 */
  async deduct(contractId: string, amount: number, reason: string, operatorId: string) {
    return this.changeBalance(contractId, amount, 'DEDUCT', reason, operatorId);
  }

  /** 退还押金；余额不足 400。 */
  async refund(contractId: string, amount: number, reason: string, operatorId: string) {
    return this.changeBalance(contractId, amount, 'REFUND', reason, operatorId);
  }

  /** 押金转移到新合同（续签，DEC-09）。 */
  async transfer(fromContractId: string, toContractId: string, operatorId: string) {
    if (fromContractId === toContractId) {
      throw new BadRequestException('不能转移到同一合同');
    }

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.depositLedger.findUnique({ where: { contractId: fromContractId } });
      if (!source) throw new NotFoundException('源合同暂无押金台账');
      if (source.balance <= 0) throw new BadRequestException('源合同押金余额为 0');

      const targetContract = await tx.contract.findUnique({
        where: { id: toContractId },
        select: { id: true, tenantId: true, roomId: true, depositAmount: true },
      });
      if (!targetContract) throw new NotFoundException('目标合同不存在');

      const moved = source.balance;
      const target = await tx.depositLedger.upsert({
        where: { contractId: toContractId },
        create: {
          contractId: toContractId,
          tenantId: targetContract.tenantId,
          roomId: targetContract.roomId,
          amount: targetContract.depositAmount,
          balance: 0,
          status: 'PARTIAL',
        },
        update: {},
      });

      const targetBalance = target.balance + moved;
      await tx.depositLedger.update({
        where: { id: source.id },
        data: { balance: 0, status: 'REFUNDED' },
      });
      await tx.depositLedger.update({
        where: { id: target.id },
        data: {
          balance: targetBalance,
          status: targetBalance >= target.amount ? 'HELD' : 'PARTIAL',
        },
      });

      await tx.depositTransaction.create({
        data: {
          ledgerId: source.id,
          type: 'TRANSFER',
          amount: -moved,
          balanceAfter: 0,
          relatedType: 'CONTRACT',
          relatedId: toContractId,
          operatorId,
          notes: '押金转入续签合同',
        },
      });
      await tx.depositTransaction.create({
        data: {
          ledgerId: target.id,
          type: 'TRANSFER',
          amount: moved,
          balanceAfter: targetBalance,
          relatedType: 'CONTRACT',
          relatedId: fromContractId,
          operatorId,
          notes: '承接续签合同押金',
        },
      });

      return { from: source.id, to: target.id, moved, targetBalance };
    });
  }

  private async changeBalance(
    contractId: string,
    amount: number,
    type: 'DEDUCT' | 'REFUND',
    reason: string,
    operatorId: string,
  ) {
    if (amount <= 0) throw new BadRequestException('金额必须大于 0');

    return this.prisma.$transaction(async (tx) => {
      const ledger = await tx.depositLedger.findUnique({ where: { contractId } });
      if (!ledger) throw new NotFoundException('该合同暂无押金台账');
      if (amount > ledger.balance) {
        throw new BadRequestException(`押金余额不足（当前 ${ledger.balance} 分）`);
      }

      const balance = ledger.balance - amount;
      const updated = await tx.depositLedger.update({
        where: { id: ledger.id },
        data: {
          balance,
          status: balance === 0 && type === 'REFUND' ? 'REFUNDED' : 'PARTIAL',
        },
      });

      await tx.depositTransaction.create({
        data: {
          ledgerId: ledger.id,
          type,
          amount: -amount,
          balanceAfter: balance,
          operatorId,
          notes: reason,
        },
      });

      return { ledger: updated, balance };
    });
  }
}
