import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class QueryStaffDto {
  @IsOptional() @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @IsInt() @Min(1) pageSize?: number = 20;
  @IsOptional() @IsEnum(['ADMIN', 'CLEANER']) role?: 'ADMIN' | 'CLEANER';
  @IsOptional() @IsString() keyword?: string;
}

export class CreateStaffDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsEnum(['ADMIN', 'CLEANER']) role: 'ADMIN' | 'CLEANER';
}

export class UpdateStaffDto {
  @IsOptional() @IsEnum(['ADMIN', 'CLEANER']) role?: 'ADMIN' | 'CLEANER';
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(32) phone?: string | null;
}

export class ResetStaffPasswordDto {
  @IsString() @MinLength(8) newPassword: string;
}
