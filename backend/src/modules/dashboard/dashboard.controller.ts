import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/**
 * 后台首页仪表板
 * 仅管理员可访问
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** 统计卡片：房源/租客/合同/账单/报修 */
  @Get('stats')
  getStats() {
    return this.dashboardService.getStats();
  }

  /** 近 N 个月收入趋势（默认 6 个月） */
  @Get('revenue-trend')
  getRevenueTrend(@Query('months') months?: string) {
    return this.dashboardService.getRevenueTrend(
      months !== undefined ? Number.parseInt(months, 10) : 6,
    );
  }

  /** 房源状态分布 */
  @Get('room-status')
  getRoomStatus() {
    return this.dashboardService.getRoomStatus();
  }
}
