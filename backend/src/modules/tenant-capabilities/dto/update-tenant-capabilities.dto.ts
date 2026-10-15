import { IsArray, IsOptional, IsObject, IsString } from 'class-validator';

export class UpdateTenantCapabilitiesDto {
  @IsArray({ message: 'denied 必须是数组' })
  @IsString({ each: true, message: 'denied 元素必须是字符串' })
  denied!: string[];

  @IsOptional()
  @IsObject({ message: 'reasons 必须是对象' })
  reasons?: Record<string, string>;
}
