import { IsEnum } from 'class-validator';
import { TenantStatus } from '@prisma/client';

export class ChangeTenantStatusDto {
  @IsEnum(TenantStatus)
  status: TenantStatus;
}
