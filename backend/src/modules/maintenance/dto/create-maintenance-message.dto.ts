import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMaintenanceMessageDto {
  @IsString()
  @MinLength(1, { message: '留言不能为空' })
  @MaxLength(2000, { message: '留言不能超过 2000 字' })
  body: string;
}
