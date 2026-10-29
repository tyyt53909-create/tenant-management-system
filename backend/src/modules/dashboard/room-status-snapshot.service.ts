import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One SQL statement counts a building at one database snapshot. Never overwrites history. */
@Injectable()
export class RoomStatusSnapshotService {
  constructor(private readonly prisma: PrismaService, private readonly clock: BusinessClock) {}

  async capture(buildingId: string) {
    const startedAt = this.clock.now();
    const businessDate = this.clock.todayUtc(startedAt);
    return this.prisma.$transaction(async tx => {
      // A single statement sees one database snapshot. A conflict leaves the old row untouched.
      const inserted = await tx.$executeRaw`
        INSERT INTO "room_status_snapshots"
          ("id", "buildingId", "businessDate", "capturedAt", "total", "vacant", "reserved", "occupied", "maintenance")
        SELECT ${randomUUID()}, b."id", ${businessDate}::date, ${startedAt},
          count(r."id")::int,
          count(r."id") FILTER (WHERE r."status" = 'VACANT')::int,
          count(r."id") FILTER (WHERE r."status" = 'RESERVED')::int,
          count(r."id") FILTER (WHERE r."status" = 'OCCUPIED')::int,
          count(r."id") FILTER (WHERE r."status" = 'MAINTENANCE')::int
        FROM "buildings" b LEFT JOIN "rooms" r ON r."buildingId" = b."id"
        WHERE b."id" = ${buildingId}
        GROUP BY b."id"
        ON CONFLICT ("buildingId", "businessDate") DO NOTHING
      `;
      // Do not commit a capture whose database work crossed the business-day boundary.
      const capturedAt = this.clock.now();
      if (this.clock.todayUtc(capturedAt).getTime() !== businessDate.getTime()) {
        throw new ConflictException('捕获跨越业务日，请重试');
      }
      const key = { buildingId_businessDate: { buildingId, businessDate } };
      if (inserted === 1) {
        // Only the newly inserted, uncommitted row receives the completion time.
        return tx.roomStatusSnapshot.update({ where: key, data: { capturedAt } });
      }
      const existing = await tx.roomStatusSnapshot.findUnique({ where: key });
      if (!existing) throw new NotFoundException('楼栋不存在');
      return existing;
    });
  }

  async get(buildingId: string, date: string) {
    const businessDate = typeof date === 'string' ? this.clock.parseDateOnly(date) : null;
    if (!businessDate) throw new BadRequestException('日期须为有效的 YYYY-MM-DD');
    const building = await this.prisma.building.findUnique({ where: { id: buildingId }, select: { id: true } });
    if (!building) throw new NotFoundException('楼栋不存在');
    // Null explicitly means no capture, not an empty building.
    return this.prisma.roomStatusSnapshot.findUnique({ where: { buildingId_businessDate: { buildingId, businessDate } } });
  }
}
