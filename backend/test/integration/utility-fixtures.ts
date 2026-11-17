import { prisma } from './harness.js';
import type { UtilityCollectionMode } from '@prisma/client';

/** Explicit test consent and responsibility; never used by production or inferred from an account. */
export async function confirmedMeterFixture(meterId: string, contractId?: string, closingReadingId?: string, mode: UtilityCollectionMode = 'PREPAY_WITH_SHORTFALL') {
  const meter = await prisma.meter.findUniqueOrThrow({ where: { id: meterId } });
  const lease = contractId ? await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })
    : await prisma.contract.findFirstOrThrow({ where: { roomId: meter.roomId!, status: 'ACTIVE' } });
  const opening = await prisma.meterReading.findFirstOrThrow({ where: { meterId, source: { not: 'SIMULATED' } }, orderBy: { readingTime: 'asc' } });
  const closing = closingReadingId ? await prisma.meterReading.findUniqueOrThrow({ where: { id: closingReadingId } }) : null;
  const policy = await prisma.utilityPolicyVersion.findFirst({ where: { contractId: lease.id, feeType: meter.meterType }, orderBy: { version: 'desc' } });
  if (!policy) await prisma.utilityPolicyVersion.create({ data: {
    contractId: lease.id, feeType: meter.meterType, version: 1, collectionMode: mode, rateCents: meter.unitPrice,
    unit: meter.meterType === 'ELECTRICITY' ? 'kWh' : 'm³', effectiveFrom: opening.readingTime, confirmedBy: 'integration-admin', evidence: 'Explicit test lease collection consent and baseline evidence',
  } });
  return prisma.meterResponsibilityInterval.create({ data: {
    meterId, roomId: meter.roomId!, contractId: lease.id, tenantId: lease.tenantId, responsibility: 'TENANT',
    startAt: opening.readingTime, openingReadingId: opening.id, endAt: closing?.readingTime, closingReadingId: closing?.id,
    confirmedBy: 'integration-admin', evidence: 'Explicit test responsibility evidence',
  } });
}
export async function confirmedRateFixture(meterId: string, rateCents: number, at: string) {
  const meter = await prisma.meter.findUniqueOrThrow({ where: { id: meterId } });
  const prior = await prisma.utilityPolicyVersion.findFirstOrThrow({ where: { feeType: meter.meterType, contract: { roomId: meter.roomId! } }, orderBy: { version: 'desc' } });
  const { id: _id, ...copy } = prior;
  return prisma.utilityPolicyVersion.create({ data: { ...copy, rateCents, version: prior.version + 1, effectiveFrom: new Date(at), evidence: 'Explicitly confirmed test tariff revision; real boundary still required' } });
}
