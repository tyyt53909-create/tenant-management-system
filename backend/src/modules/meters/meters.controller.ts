import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Res, Req, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetersService } from './meters.service.js';
import { MetersSimulatorService } from './meters-simulator.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { QueryUsageOverviewDto } from './dto/query-usage-overview.dto.js';
import { QueryReconciliationDto } from './dto/query-reconciliation.dto.js';
import { MeterReconciliationService } from './meter-reconciliation.service.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { SetMeterPriceDto } from './dto/set-meter-price.dto.js';
import { SetMeterDefaultPriceDto } from './dto/set-meter-default-price.dto.js';
import { RunSimulationDto } from './dto/run-simulation.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import type { ExportMeterReadingsQuery } from './meter-usage-query.service.js';
import { isMeterSimulatorEnabled } from '../../config/feature-flags.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

@Controller('meters')
@UseGuards(JwtAuthGuard)
export class MetersController {
  constructor(
    private readonly metersService: MetersService,
    private readonly metersSimulatorService: MetersSimulatorService,
    private readonly reconciliationService: MeterReconciliationService,
    private readonly clock: BusinessClock,
  ) {}

  /**
   * 水电对账（T218）：读数 / 扣费 / 账单三方交叉核对，只读。
   * 只有管理员可用；租客只在自己的账单里看到扣费结果。
   */
  @Get('reconciliation')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  reconcile(@Query() query: QueryReconciliationDto) {
    const period = query.period ?? previousMonth();
    return this.reconciliationService.reconcile({
      period,
      buildingId: query.buildingId,
      meterType: query.meterType as never,
    });
  }

  // 运行虚拟水电表模拟器（仅 ADMIN）
  @Post('simulator/run')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  runSimulation(@CurrentUser() userParam: CurrentUserParam, @Body() dto: RunSimulationDto) {
    if (!isMeterSimulatorEnabled()) {
      throw new NotFoundException();
    }
    const user = resolveAuthUser(userParam);
    return this.metersSimulatorService.runSimulation(dto, user.userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@CurrentUser() userParam: CurrentUserParam, @Body() createMeterDto: CreateMeterDto) {
    const user = resolveAuthUser(userParam);
    return this.metersService.create(createMeterDto, user.userId);
  }

  // 设置中心：表类型默认价（仅 ADMIN，T276）
  @Get('price-defaults')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  listTypeDefaults() {
    return this.metersService.listTypeDefaults();
  }

  @Post('price-defaults')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setTypeDefault(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: SetMeterDefaultPriceDto,
    @Req() request: Request,
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.setTypeDefault(dto, {
      userId: user.userId,
      ip: request.ip ?? '',
      userAgent: request.headers['user-agent'] ?? '',
    });
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
  createBatchReadings(@CurrentUser() userParam: CurrentUserParam, @Body() dto: BatchMeterReadingsDto) {
    const user = resolveAuthUser(userParam);
    return this.metersService.createBatchReadings(dto, user.userId);
  }

  // 批量周期结算水电表（仅 ADMIN）
  @Post('settle-batch')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  settleBatch(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: { buildingId?: string; meterIds?: string[]; settleUntil?: string; notes?: string },
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.settleBatch(dto, user.userId);
  }

  // 抄表台账 CSV 导出（仅 ADMIN）
  @Get('readings/export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportReadings(@Query() query: ExportMeterReadingsQuery, @Res({ passthrough: true }) res: Response) {
    const csv = await this.metersService.exportReadings(query);
    const dateStr = this.clock.formatDate().replace(/-/g, '');
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
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CreateMeterReadingDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.createReading(id, dto, user.userId);
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
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: SettleMeterDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.settleMeter(id, dto, user.userId);
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

  // 价格历史（表级调价 + 类型默认价，T274）
  @Get(':id/price-history')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  priceHistory(@Param('id') id: string) {
    return this.metersService.priceHistory(id);
  }

  // 调价：写价格历史并更新当前价（T274）
  @Post(':id/price')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  setPrice(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: SetMeterPriceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.setPrice(id, dto, user.userId);
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
  update(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() updateMeterDto: UpdateMeterDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.metersService.update(id, updateMeterDto, user.userId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.metersService.remove(id);
  }
}

/** 未指定账期时默认上个月（月初对账最常见） */
function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
