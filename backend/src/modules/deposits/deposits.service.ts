import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  async deduct(contractId: string, amount: number, reason: string, operatorId: string, idempotencyKey?: string) {
    return this.changeBalance(contractId, amount, 'DEDUCT', reason, operatorId, idempotencyKey);
  }

  /** 退还押金；余额不足 400。 */
  async refund(contractId: string, amount: number, reason: string, operatorId: string, idempotencyKey?: string) {
    return this.changeBalance(contractId, amount, 'REFUND', reason, operatorId, idempotencyKey);
  }

  /** 押金转移到新合同（续签，DEC-09）。 */
  async transfer(fromContractId: string, toContractId: string, operatorId: string, idempotencyKey?: string) {
    if (fromContractId === toContractId) {
      throw new BadRequestException('不能转移到同一合同');
    }

    return this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const replay = await tx.depositTransaction.findUnique({ where: { idempotencyKey } });
        if (replay) {
          if (replay.type !== 'TRANSFER' || replay.relatedId !== toContractId) {
            throw new ConflictException('幂等键已用于其他押金操作');
          }
          return { from: replay.ledgerId, to: toContractId, moved: Math.abs(replay.amount), targetBalance: replay.balanceAfter, idempotent: true };
        }
      }

      const [firstId, secondId] = [fromContractId, toContractId].sort();
      await lockLedger(tx, firstId);
      await lockLedger(tx, secondId);

      const sourceContract = await tx.contract.findUnique({
        where: { id: fromContractId },
        select: { id: true, tenantId: true, roomId: true },
      });
      const targetContract = await tx.contract.findUnique({
        where: { id: toContractId },
        select: { id: true, tenantId: true, roomId: true, depositAmount: true, renewedFromId: true },
      });
      if (!sourceContract) throw new NotFoundException('源合同不存在');
      if (!targetContract) throw new NotFoundException('目标合同不存在');
      if (targetContract.renewedFromId !== fromContractId) {
        throw new BadRequestException('只能把押金转移到由该合同续签出来的新合同');
      }
      if (sourceContract.tenantId !== targetContract.tenantId) {
        throw new BadRequestException('不能跨租客转移押金');
      }

      const source = await tx.depositLedger.findUnique({ where: { contractId: fromContractId } });
      if (!source) throw new NotFoundException('源合同暂无押金台账');
      if (source.balance <= 0) throw new BadRequestException('源合同押金余额为 0');

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
          idempotencyKey,
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
    idempotencyKey?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('金额必须大于 0');

    return this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const replay = await tx.depositTransaction.findUnique({ where: { idempotencyKey } });
        if (replay) {
          if (replay.type !== type || replay.amount !== -amount) {
            throw new ConflictException('幂等键已用于其他押金操作');
          }
          return { ledgerId: replay.ledgerId, balance: replay.balanceAfter, idempotent: true };
        }
      }
      await lockLedger(tx, contractId);
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
          idempotencyKey,
        },
      });

      return { ledger: updated, balance };
    });
  }
}

async function lockLedger(tx: Prisma.TransactionClient, contractId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM deposit_ledgers WHERE "contractId" = ${contractId} FOR UPDATE`);
}
