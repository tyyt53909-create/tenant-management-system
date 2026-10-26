import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  Matches,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePublicAppointmentDto {
  @IsString({ message: '房源 ID 必须为字符串' })
  @IsNotEmpty({ message: '房源 ID 不能为空' })
  roomId: string;

  @IsString({ message: '预约人姓名必须为字符串' })
  @IsNotEmpty({ message: '预约人姓名不能为空' })
  @MaxLength(50, { message: '姓名最多50字符' })
  name: string;

  @IsString({ message: '手机号必须为字符串' })
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsDateString({}, { message: '预约看房时间必须为合法的日期时间格式' })
  @IsNotEmpty({ message: '预约看房时间不能为空' })
  appointmentTime: string;

  @IsInt({ message: '看房人数必须为整数' })
  @Min(1, { message: '看房人数至少1人' })
  @Max(20, { message: '看房人数不能超过20人' })
  @IsOptional()
  @Type(() => Number)
  visitorsCount?: number = 1;

  @IsString({ message: '备注必须为字符串' })
  @MaxLength(500, { message: '备注最多500字符' })
  @IsOptional()
  notes?: string;
}
