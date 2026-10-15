import { IsEnum, IsOptional, IsString, IsNumber, IsBoolean, IsArray, Min, Max } from 'class-validator';

export enum SimulationScenario {
  DAILY_HOURLY = 'DAILY_HOURLY',
  TIME_TRAVEL_MONTH = 'TIME_TRAVEL_MONTH',
  ANOMALY_TEST = 'ANOMALY_TEST',
}

export class RunSimulationDto {
  /** 模拟场景：24小时日曲线、30天月度时间穿梭、异常重放与防御自检 */
  @IsEnum(SimulationScenario, {
    message: 'scenario 必须是 DAILY_HOURLY, TIME_TRAVEL_MONTH, ANOMALY_TEST 之一',
  })
  scenario!: SimulationScenario;

  /** 指定目标表计 ID（可选，缺省则按楼栋或自动选取激活表计） */
  @IsOptional()
  @IsString()
  meterId?: string;

  /** 指定楼栋 ID（可选） */
  @IsOptional()
  @IsString()
  buildingId?: string;

  /** 模拟天数（针对 TIME_TRAVEL_MONTH，默认 30 天，1~90） */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(90)
  days?: number;

  /** 是否自动结算扣费（默认 false，仅上报未结算用量留存，待后续周期结算） */
  @IsOptional()
  @IsBoolean()
  autoSettle?: boolean;

  /** 异常测试类型列表（针对 ANOMALY_TEST，可选） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  faultTypes?: string[];

  /** 随机波动因子（0~1，默认 0.15） */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  variance?: number;
}
