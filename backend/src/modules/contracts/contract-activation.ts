import type { Prisma } from '@prisma/client';

/** Serializes activation and check-in for the same room. */
export async function lockLeaseRoom(tx: Prisma.TransactionClient, roomId: string) {
  await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`;
}

/** Called while holding the room lock, with the draft read inside that transaction. */
export async function activateConfirmedLease(
  tx: Prisma.TransactionClient,
  lease: { id: string; roomId: string; renewedFromId: string | null; startDate: Date; endDate: Date; status: string; leaseConfirmedAt: Date | null },
  today: Date,
): Promise<boolean> {
  if (lease.status !== 'DRAFT' || !lease.leaseConfirmedAt || lease.startDate > today || lease.endDate < today) return false;

  const occupying = await tx.contract.findFirst({
    where: { roomId: lease.roomId, status: 'ACTIVE', id: { not: lease.id } },
    select: { id: true, endDate: true },
  });
  if (occupying) {
    if (occupying.id !== lease.renewedFromId || occupying.endDate >= lease.startDate) return false;
    await tx.contract.update({ where: { id: occupying.id }, data: { status: 'RENEWED' } });
  }
  await tx.contract.update({ where: { id: lease.id }, data: { status: 'ACTIVE' } });
  return true;
}
