import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '租户编码仅允许字母、数字、下划线和中划线' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}
