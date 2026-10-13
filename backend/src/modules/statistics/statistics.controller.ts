import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service.js';
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

  /**
   * 统计总览
   * 时间维度：当月/本季/本年/自定义；空间维度：整楼/按楼层
   */
  @Get('overview')
  overview(@Query() query: QueryStatisticsDto) {
    return this.statisticsService.overview(query);
  }
}
