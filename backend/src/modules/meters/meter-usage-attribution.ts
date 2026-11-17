import type { Prisma } from '@prisma/client';
import type { BusinessClock } from '../../common/business-clock/business-clock.service.js';

type UsageOwner =
  | { kind: 'TENANT'; contractId: string; tenantId: string; tenantName: string }
  | { kind: 'VACANT' }
  | { kind: 'UNKNOWN' };

/**
 * Resolve the whole interval (baseline, target], not just the tenant at its end.
 * An exact checkout read can close the old interval and an exact check-in read
 * can close the vacancy interval. A lease date alone is not a turnover reading.
 */
export async function resolveMeterUsageOwner(
  db: Pick<Prisma.TransactionClient, 'contract'>,
  clock: BusinessClock,
  roomId: string,
  baselineTime: Date | undefined,
  targetTime: Date,
): Promise<UsageOwner> {
  if (!baselineTime || baselineTime >= targetTime) return { kind: 'UNKNOWN' };

  const startDay = clock.todayUtc(baselineTime);
  const targetDay = clock.todayUtc(targetTime);
  const contracts = await db.contract.findMany({
    where: { roomId },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      tenantId: true,
      renewedFromId: true,
      startDate: true,
      endDate: true,
      status: true,
      tenant: { select: { name: true } },
      room: { select: { status: true } },
      moveIn: { select: { occupiedAt: true } },
      inspections: {
        where: { status: 'CONFIRMED' },
        select: { type: true, inspectedAt: true, tenantConfirmedAt: true, roomId: true, tenantId: true },
      },
      checkoutRecords: {
        where: { status: 'COMPLETED' },
        select: { checkoutDate: true, roomId: true },
      },
    },
  });

  const history = contracts.filter((contract) => contract.status !== 'DRAFT' || contract.inspections.length > 0);

  // A recorded, consecutive renewal for the same tenant keeps the occupancy evidence.
  // The two contracts still have separate billing intervals.
  const continuesOccupancy = (previous: (typeof history)[number] | undefined, next: (typeof history)[number] | undefined) =>
    previous?.status === 'RENEWED' && next?.renewedFromId === previous.id
    && next.tenantId === previous.tenantId
    && previous.checkoutRecords.length === 0
    && !previous.inspections.some(({ type }) => type === 'CHECK_OUT')
    && clock.addDays(previous.endDate, 1).getTime() === next.startDate.getTime();

  const windows = history.map((contract, index) => {
    const checkIns = contract.inspections.filter(({ type }) => type === 'CHECK_IN');
    const checkOuts = contract.inspections.filter(({ type }) => type === 'CHECK_OUT');
    const entry = contract.moveIn?.occupiedAt ?? checkIns[0]?.inspectedAt;
    const exit = checkOuts[0]?.inspectedAt;
    const checkoutDay = contract.checkoutRecords[0]?.checkoutDate;
    const hasConflictingEvidence = checkIns.length > 1 || checkOuts.length > 1
      || contract.checkoutRecords.length > 1
      || contract.inspections.some((inspection) =>
        inspection.roomId !== roomId || inspection.tenantId !== contract.tenantId
        || !inspection.tenantConfirmedAt || inspection.tenantConfirmedAt < inspection.inspectedAt)
      || contract.checkoutRecords.some((checkout) => checkout.roomId !== roomId || checkout.checkoutDate < contract.startDate)
      || Boolean(entry && exit && entry >= exit)
      || Boolean(exit && checkoutDay && clock.todayUtc(exit).getTime() !== checkoutDay.getTime());

    if (hasConflictingEvidence) {
      // 等待人工复核争议交接，包含名义租期及所有交接日。
      const evidenceDays = [
        ...contract.inspections.map(({ inspectedAt }) => clock.todayUtc(inspectedAt)),
        ...contract.checkoutRecords.map(({ checkoutDate }) => checkoutDate),
      ];
      return {
        contract, entry: undefined, exit: undefined,
        overlaps: (contract.startDate <= targetDay || evidenceDays.some((day) => day <= targetDay))
          && (contract.endDate >= startDay || evidenceDays.some((day) => day >= startDay)),
        covers: false,
      };
    }

    const overlaps = (entry ? entry < targetTime : contract.startDate <= targetDay)
      && (exit ? exit > baselineTime : (checkoutDay ?? contract.endDate) >= startDay);

    // For an original lease the recorded activation/occupancy transition is the legacy
    // start evidence. After a turnover, require the actual handover on the new contract.
    const legacyStart = (index === 0 || continuesOccupancy(history[index - 1], contract)) && (
      (contract.status === 'ACTIVE' && contract.room.status === 'OCCUPIED')
      || Boolean(exit || checkoutDay)
      || continuesOccupancy(contract, history[index + 1])
    );
    const covers = contract.status !== 'DRAFT' && startDay >= contract.startDate && targetDay <= contract.endDate
      && (entry ? baselineTime >= entry : legacyStart)
      && (exit ? targetTime <= exit
        : checkoutDay ? targetDay < checkoutDay : contract.status !== 'TERMINATED');

    return { contract, entry, exit, overlaps, covers };
  });

  const overlaps = windows.filter((window) => window.overlaps);
  const owner = overlaps[0];
  if (overlaps.length === 1 && owner.covers) {
    const { id: contractId, tenantId, tenant } = owner.contract;
    return { kind: 'TENANT', contractId, tenantId, tenantName: tenant.name };
  }

  if (overlaps.length === 0 && windows.some(({ exit }, index) => {
    const nextEntry = windows[index + 1]?.entry;
    return exit && nextEntry && exit <= baselineTime && targetTime <= nextEntry;
  })) {
    return { kind: 'VACANT' };
  }

  return { kind: 'UNKNOWN' };
}
