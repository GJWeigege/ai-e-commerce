import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PlatformCode } from '@prisma/client';

export class CreateShopDto {
  @IsUUID()
  tenantId: string;

  @IsEnum(PlatformCode)
  platform: PlatformCode;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiToken?: string;

  /** WB 卖家后台已登记品牌，写入 extra.brand */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  wbBrand?: string;
}

export class UpdateShopDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  apiToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  wbBrand?: string;
}

export class ShopStatusDto {
  @IsIn(['ENABLED', 'DISABLED'])
  status: 'ENABLED' | 'DISABLED';
}
