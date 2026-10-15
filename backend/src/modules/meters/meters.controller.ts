import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, Res } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { QueryUsageOverviewDto } from './dto/query-usage-overview.dto.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('meters')
@UseGuards(JwtAuthGuard)
export class MetersController {
  constructor(private readonly metersService: MetersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createMeterDto: CreateMeterDto) {
    return this.metersService.create(createMeterDto);
  }

  // 批量抄表底表（仅 ADMIN）
  @Get('batch-sheet')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getBatchSheet(@Query() query: QueryBatchSheetDto) {
    return this.metersService.getBatchSheet(query);
  }

  // 批量登记读数（仅 ADMIN）
  @Post('batch-readings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createBatchReadings(@Request() req: any, @Body() dto: BatchMeterReadingsDto) {
    return this.metersService.createBatchReadings(dto, req.user.userId);
  }

  // 批量周期结算水电表（仅 ADMIN）
  @Post('settle-batch')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  settleBatch(
    @Request() req: any,
    @Body() dto: { buildingId?: string; meterIds?: string[]; settleUntil?: string; notes?: string },
  ) {
    return this.metersService.settleBatch(dto, req.user.userId);
  }

  // 抄表台账 CSV 导出（仅 ADMIN）
  @Get('readings/export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportReadings(@Query() query: any, @Res({ passthrough: true }) res: any) {
    const csv = await this.metersService.exportReadings(query);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="meter-readings-${dateStr}.csv"`);
    return csv;
  }

  // 工作台水电使用概览（ADMIN）
  @Get('usage-overview')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getUsageOverview(@Query() query: QueryUsageOverviewDto) {
    return this.metersService.getUsageOverview(query);
  }

  // 水电表档案：仅管理者（docs/03-权限矩阵.md §3.5，租客仅可看自己房间读数）
  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryMetersDto) {
    return this.metersService.findAll(query);
  }

  // 登記讀數（自動扣費，僅 ADMIN）
  @Post(':id/readings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createReading(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateMeterReadingDto,
  ) {
    return this.metersService.createReading(id, dto, req.user.userId);
  }

  // 讀數歷史（分頁）
  @Get(':id/readings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findReadings(@Param('id') id: string, @Query() query: QueryMeterReadingsDto) {
    return this.metersService.findReadings(id, query);
  }

  // 周期结算指定水电表（仅 ADMIN）
  @Post(':id/settle')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  settleMeter(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SettleMeterDto,
  ) {
    return this.metersService.settleMeter(id, dto, req.user.userId);
  }

  // 查询水电表未结算用量及预估金额（仅 ADMIN）
  @Get(':id/unsettled-usage')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getUnsettledUsage(
    @Param('id') id: string,
    @Query('settleUntil') settleUntil?: string,
  ) {
    return this.metersService.getUnsettledUsage(id, settleUntil);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findOne(@Param('id') id: string) {
    return this.metersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateMeterDto: UpdateMeterDto) {
    return this.metersService.update(id, updateMeterDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.metersService.remove(id);
  }
}
