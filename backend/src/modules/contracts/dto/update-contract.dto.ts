import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateContractDto } from './create-contract.dto.js';

enum ContractStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  TERMINATED = 'TERMINATED',
  RENEWED = 'RENEWED',
}

export class UpdateContractDto extends PartialType(CreateContractDto) {
  @IsEnum(ContractStatus)
  @IsOptional()
  status?: ContractStatus;
}
