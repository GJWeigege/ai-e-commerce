import { IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CollectorType } from '@prisma/client';

export class AgentProductDto {
  @IsString()
  skuId: string;

  @IsString()
  name: string;

  @IsString()
  sourceUrl: string;

  @IsOptional()
  @IsString()
  mainImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @Type(() => Number)
  @IsNumber()
  price: number;

  @Type(() => Number)
  @IsNumber()
  stock: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fboStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fbsStock?: number;

  @IsOptional()
  @IsIn(['FBO', 'FBS', 'MIXED'])
  warehouseType?: 'FBO' | 'FBS' | 'MIXED';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  salesCount?: number;

  @IsOptional()
  currency?: string;

  @IsOptional()
  specs?: Array<{ name: string; value: string }>;

  @IsOptional()
  categoryPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discountPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  reviewCount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videoUrls?: string[];

  @IsOptional()
  @IsArray()
  variants?: Array<{
    name: string;
    values: Array<{
      value: string;
      selected?: boolean;
      skuId?: string;
      sourceUrl?: string;
      price?: number;
      imageUrls?: string[];
    }>;
  }>;

  @IsOptional()
  @IsArray()
  skuOptions?: Array<{
    skuId: string;
    name: string;
    sourceUrl: string;
    price?: number;
    originalPrice?: number;
    discountPrice?: number;
    imageUrls?: string[];
    options?: Record<string, string>;
  }>;

  /** 采集端内部标志，接口忽略；兼容 Chrome 插件误带回传 */
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  /** 「采集本页」时是否跟进全部规格 SKU；缺省为只保留当前页主 SKU */
  @IsOptional()
  @IsBoolean()
  crawlAllSkus?: boolean;
}

export class ClaimTaskDto {
  @IsString()
  agentKey: string;

  @IsEnum(CollectorType)
  type: CollectorType;
}

export class AgentListingDto {
  @IsString()
  agentKey: string;

  @IsArray()
  @IsString({ each: true })
  urls: string[];
}

export class AgentResultDto {
  @IsString()
  agentKey: string;

  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  failCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentProductDto)
  product?: AgentProductDto;
}
