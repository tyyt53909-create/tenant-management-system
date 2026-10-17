import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';
import { BatchMeterReadingsDto, QueryBatchSheetDto } from './dto/batch-meter-reading.dto.js';
import { QueryUsageOverviewDto } from './dto/query-usage-overview.dto.js';
import { SettleMeterDto } from './dto/settle-meter.dto.js';
import { METER_ADAPTER, type MeterAdapter } from './adapters/meter-adapter.js';
import { ManualMeterAdapter } from './adapters/manual-meter.adapter.js';
import { METER_TYPE_LABEL } from './meter-types.constants.js';
import { MeterService } from './meter.service.js';
import { MeterReadingService } from './meter-reading.service.js';
import { MeterBatchReadingService } from './meter-batch-reading.service.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterUsageQueryService, type ExportMeterReadingsQuery } from './meter-usage-query.service.js';

export { METER_TYPE_LABEL };

@Injectable()
export class MetersService {
  private readonly meterService: MeterService;
  private readonly readingService: MeterReadingService;
  private readonly batchReadingService: MeterBatchReadingService;
  private readonly billingService: MeterBillingService;
  private readonly usageQueryService: MeterUsageQueryService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() meterService?: MeterService,
    @Optional() readingService?: MeterReadingService,
    @Optional() batchReadingService?: MeterBatchReadingService,
    @Optional() billingService?: MeterBillingService,
    @Optional() usageQueryService?: MeterUsageQueryService,
    @Optional() @Inject(METER_ADAPTER) meterAdapter?: MeterAdapter,
  ) {
    const adapter = meterAdapter ?? new ManualMeterAdapter(prisma);
    this.meterService = meterService ?? new MeterService(prisma, adapter);
    this.billingService = billingService ?? new MeterBillingService(prisma);
    this.readingService = readingService ?? new MeterReadingService(prisma, this.billingService);
    this.batchReadingService = batchReadingService ?? new MeterBatchReadingService(prisma, this.billingService);
    this.usageQueryService = usageQueryService ?? new MeterUsageQueryService(prisma);
  }

  /** 按当前适配器取最新读数 */
  fetchReading(meterId: string) {
    return this.meterService.fetchReading(meterId);
  }

  async create(dto: CreateMeterDto) {
    return this.meterService.create(dto);
  }

  async findAll(query: QueryMetersDto) {
    return this.meterService.findAll(query);
  }

  async findOne(id: string) {
    return this.meterService.findOne(id);
  }

  async update(id: string, dto: UpdateMeterDto) {
    return this.meterService.update(id, dto);
  }

  async remove(id: string) {
    return this.meterService.remove(id);
  }

  /** 水電讀數登記 */
  async createReading(
    meterId: string,
    dto: Omit<CreateMeterReadingDto, 'source'> & { source?: 'MANUAL' | 'DEVICE' | 'SIMULATED' },
    operatorId: string,
  ) {
    return this.readingService.createReading(meterId, dto, operatorId);
  }

  /** 讀數歷史 */
  async findReadings(meterId: string, query: QueryMeterReadingsDto) {
    return this.readingService.findReadings(meterId, query);
  }

  /** 批量抄表工作台底表查询 */
  async getBatchSheet(query: QueryBatchSheetDto) {
    return this.batchReadingService.getBatchSheet(query);
  }

  /** 批量读数登记 */
  async createBatchReadings(dto: BatchMeterReadingsDto, operatorId: string) {
    return this.batchReadingService.createBatchReadings(dto, operatorId);
  }

  /** 抄表台账数据 CSV 导出 */
  async exportReadings(query: ExportMeterReadingsQuery) {
    return this.usageQueryService.exportReadings(query);
  }

  /** 水电用量看板数据聚合 */
  async getUsageOverview(query: QueryUsageOverviewDto) {
    return this.usageQueryService.getUsageOverview(query);
  }

  /** 查看水电表未结算用量与预估金额 */
  async getUnsettledUsage(meterId: string, settleUntilStr?: string) {
    return this.billingService.getUnsettledUsage(meterId, settleUntilStr);
  }

  /** 周期结算指定水电表 */
  async settleMeter(meterId: string, dto: SettleMeterDto, operatorId: string) {
    return this.billingService.settleMeter(meterId, dto, operatorId);
  }

  /** 批量周期结算 */
  async settleBatch(
    dto: { buildingId?: string; meterIds?: string[]; settleUntil?: string; notes?: string },
    operatorId: string,
  ) {
    return this.billingService.settleBatch(dto, operatorId, (id, d, op) => this.settleMeter(id, d, op));
  }
}
