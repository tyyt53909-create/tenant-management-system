import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One SQL statement counts a building at one database snapshot. Never overwrites history. */
@Injectable()
export class RoomStatusSnapshotService {
  constructor(private readonly prisma: PrismaService, private readonly clock: BusinessClock) {}

  async capture(buildingId: string) {
    const capturedAt = this.clock.now();
    const businessDate = this.clock.todayUtc(capturedAt);
    // The SELECT's building row makes an empty building a zero-count capture, and an
    // unknown building no capture. ON CONFLICT makes concurrent retries immutable.
    await this.prisma.$executeRaw`
      INSERT INTO "room_status_snapshots"
        ("id", "buildingId", "businessDate", "capturedAt", "total", "vacant", "reserved", "occupied", "maintenance")
      SELECT ${randomUUID()}, b."id", ${businessDate}::date, ${capturedAt},
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
    const snapshot = await this.prisma.roomStatusSnapshot.findUnique({ where: { buildingId_businessDate: { buildingId, businessDate } } });
    if (!snapshot) throw new NotFoundException('楼栋不存在');
    return snapshot;
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
