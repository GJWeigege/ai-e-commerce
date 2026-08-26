import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TenantStatus } from '@prisma/client';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class TenantPageQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}
