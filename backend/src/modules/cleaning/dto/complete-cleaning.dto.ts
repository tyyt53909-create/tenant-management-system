import { IsArray, IsOptional, IsString } from 'class-validator';

export class CompleteCleaningDto {
  @IsOptional()
  @IsArray({ message: '清洁后照片必须是数组' })
  afterPhotos?: string[];

  @IsOptional()
  @IsString({ message: '完工说明必须是字符串' })
  notes?: string;
}
