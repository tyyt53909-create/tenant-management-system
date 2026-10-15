import { Transform } from 'class-transformer';
import { IsString,MinLength,MaxLength } from 'class-validator';
export class ManagementSearchDto {
  @IsString()
  @Transform(({value})=>typeof value==='string'?value.trim():value)
  @MinLength(2)
  @MaxLength(100)
  q:string;
}
