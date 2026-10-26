import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class ConfirmInspectionDto {
  @IsBoolean()
  @IsOptional()
  agree?: boolean = true; // true: 确认生效; false: 提出异议驳回

  @IsString()
  @IsOptional()
  tenantNotes?: string;

  @IsString()
  @IsOptional()
  tenantSignature?: string;
}
