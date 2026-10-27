import { IsNotEmpty, IsString } from 'class-validator';

export class AssignCleanerDto {
  @IsNotEmpty({ message: '保洁员ID不能为空' })
  @IsString({ message: '保洁员ID必须是字符串' })
  cleanerId: string;
}
