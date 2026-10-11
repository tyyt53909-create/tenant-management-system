import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto.js';

export class UpdateTenantDto extends PartialType(CreateTenantDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
