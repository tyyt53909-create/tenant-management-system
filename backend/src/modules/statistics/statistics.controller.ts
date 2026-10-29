import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { RentReportResponseDto } from './dto/rent-report-response.dto.js';
import { CurrentBalancesQueryDto, CurrentBalancesResponseDto, UnassignedPrepayResponseDto } from './dto/current-balances.dto.js';
import { StatisticsService } from './statistics.service.js';
import { RentReportDto } from './dto/rent-report.dto.js';
import { QueryStatisticsDto } from './dto/query-statistics.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/** 统计（P1 / T155）：仅管理员 */
@Controller('statistics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('unassigned-prepay')
  @ApiOkResponse({ type: UnassignedPrepayResponseDto })
  unassignedPrepay() { return this.statisticsService.unassignedPrepay(); }

  @Get('current-balances')
  @ApiOkResponse({ type: CurrentBalancesResponseDto })
  currentBalances(@Query() query: CurrentBalancesQueryDto) { return this.statisticsService.currentBalances(query); }

  @Get('rent-report')
  @ApiOkResponse({ type: RentReportResponseDto })
  rentReport(@Query() query: RentReportDto) {
    return this.statisticsService.rentReport(query);
  }

  /**
   * 统计总览
   * 时间维度：当月/本季/本年/自定义；空间维度：整楼/按楼层
   */
  @Get('overview')
  overview(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.overview(query);
  }
}
