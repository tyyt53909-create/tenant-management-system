import { IsDateString } from 'class-validator';

export class ConfirmLeaseDto {
  /** 管理员核对条款时读取的最后更新时间。 */
  @IsDateString()
  expectedUpdatedAt!: string;
}
