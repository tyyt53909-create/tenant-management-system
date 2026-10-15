import { IsBoolean } from 'class-validator';

export class UpdateTenantAccountDto {
  @IsBoolean({ message: 'isActive 必须为布尔值' })
  isActive!: boolean;
}
