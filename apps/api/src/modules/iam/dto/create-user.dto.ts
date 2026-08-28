import { ArrayUnique, IsArray, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { RoleCode } from '@prisma/client';
import { PASSWORD_COMPLEXITY, PASSWORD_COMPLEXITY_MESSAGE } from '../../../common/security/password-policy';

export class CreateUserDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(PASSWORD_COMPLEXITY, { message: PASSWORD_COMPLEXITY_MESSAGE })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  realName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsEnum(RoleCode)
  roleCode: RoleCode;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  shopIds?: string[];

  /** 操作员可访问模块（菜单码）。租户管理员忽略此项。 */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  moduleCodes?: string[];
}
