import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InspectionType, InspectionItemStatus } from '@prisma/client';

export class InspectionItemDto {
  @IsString({ message: '物品名称必须为字符串' })
  @IsNotEmpty({ message: '物品名称不能为空' })
  name: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @IsEnum(InspectionItemStatus)
  @IsOptional()
  status?: InspectionItemStatus = InspectionItemStatus.INTACT;

  @IsString()
  @IsOptional()
  damageDescription?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  repairCost?: number = 0;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateInspectionDto {
  @IsEnum(InspectionType, { message: '验房类型必须为 CHECK_IN 或 CHECK_OUT' })
  type: InspectionType;

  @IsString({ message: '关联合同ID必须为字符串' })
  @IsNotEmpty({ message: '关联合同ID不能为空' })
  contractId: string;

  @IsString({ message: '经办验房人姓名必须为字符串' })
  @IsNotEmpty({ message: '经办验房人姓名不能为空' })
  inspectorName: string;

  @IsString()
  @IsOptional()
  inspectorPhone?: string;

  @IsDateString()
  @IsOptional()
  inspectedAt?: string;

  @IsOptional()
  meterReadings?: {
    coldWater?: number;
    hotWater?: number;
    electric?: number;
    gas?: number;
    [key: string]: number | undefined;
  };

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];

  @IsString()
  @IsOptional()
  overallNotes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionItemDto)
  @IsOptional()
  items?: InspectionItemDto[];
}
