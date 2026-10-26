import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';

export class DispatchMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  assignedMaintainerId: string;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class StartMaintenanceDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CompleteMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  resolution: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  laborCost?: number = 0;

  @IsInt()
  @Min(0)
  @IsOptional()
  materialCost?: number = 0;

  @IsBoolean()
  @IsOptional()
  tenantFault?: boolean = false;

  @IsString()
  @IsOptional()
  faultReason?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsOptional()
  photos?: string[];
}

export class ConfirmMaintenanceDto {
  @IsBoolean()
  accepted: boolean;

  @IsString()
  @IsOptional()
  feedback?: string;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  rating?: number;
}

export class TransferExpenseDto {
  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
