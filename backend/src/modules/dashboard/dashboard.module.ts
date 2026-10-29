import { RoomStatusSnapshotService } from './room-status-snapshot.service.js';
import { RoomStatusSnapshotController } from './room-status-snapshot.controller.js';
import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ManagementSummaryService } from './management-summary.service.js';
import { ManagementSummaryController } from './management-summary.controller.js';
import { ManagementSearchService } from './management-search.service.js';
import { ManagementSearchController } from './management-search.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController,ManagementSummaryController,ManagementSearchController,RoomStatusSnapshotController],
  providers: [DashboardService,ManagementSummaryService,ManagementSearchService,RoomStatusSnapshotService],
  exports: [DashboardService],
})
export class DashboardModule {}
