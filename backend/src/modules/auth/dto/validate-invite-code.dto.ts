import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateInviteCodeDto {
  @IsString()
  @IsNotEmpty()
  inviteCode: string;
}
