import { Prisma } from '@prisma/client';

/** Acquire the bill before reading or writing monetary state and before locking dependent rows. */
export async function lockBillForWrite(tx: Prisma.TransactionClient, billId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM bills WHERE id = ${billId} FOR UPDATE`);
}
