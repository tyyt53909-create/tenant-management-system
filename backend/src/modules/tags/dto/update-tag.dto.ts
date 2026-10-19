import { PartialType } from '@nestjs/mapped-types';
import { CreateTagDto } from './create-tag.dto.js';

export class UpdateTagDto extends PartialType(CreateTagDto) {}
