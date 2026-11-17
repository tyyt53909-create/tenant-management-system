import { Prisma } from '@prisma/client';

/** Reads after the lock wait must see the preceding writer's committed state. */
export const BILL_WRITE_TRANSACTION = { isolationLevel: 'ReadCommitted' } as const;

/** Acquire the bill before reading or writing monetary state and before locking dependent rows. */
export async function lockBillForWrite(tx: Prisma.TransactionClient, billId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`);
}
