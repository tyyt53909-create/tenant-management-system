import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsString() @MinLength(1) @MaxLength(100) buildingId: string;
  @IsString() @MinLength(1) @MaxLength(80) category: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsInt() @Min(1) @Max(2147483647) amount: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) sourceReference?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) publicUtilityBillId?: string;
  @IsString() @MinLength(1) @MaxLength(100) requestKey: string;
}
export class RecordExpensePaymentDto {
  @IsInt() @Min(1) @Max(2147483647) amount: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) paidDate: string;
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(1) @MaxLength(500) evidence: string;
  @IsString() @MinLength(1) @MaxLength(100) requestKey: string;
}
export class QueryExpensesDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) buildingId?: string;
  @IsOptional() @IsIn(['PAID', 'UNPAID', 'CANCELLED']) status?: 'PAID' | 'UNPAID' | 'CANCELLED';
}

export class CorrectExpenseDto {
  @IsString() @MinLength(1) @MaxLength(80) category: string;
  @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsInt() @Min(1) @Max(2147483647) amount: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) sourceReference?: string;
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
export class CancelExpenseDto {
  @IsInt() @Min(0) expectedVersion: number;
  @IsString() @MinLength(1) @MaxLength(500) reason: string;
}
