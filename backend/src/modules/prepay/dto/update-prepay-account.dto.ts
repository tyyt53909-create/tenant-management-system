import { PartialType } from '@nestjs/mapped-types';
import { CreatePrepayAccountDto } from './create-prepay-account.dto.js';

export class UpdatePrepayAccountDto extends PartialType(CreatePrepayAccountDto) {}
