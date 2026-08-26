import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { CollectorType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';

export class CreateCategoryTaskDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEnum(CollectorType)
  collectorType?: CollectorType;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topN = 10;

  @IsOptional()
  @IsString()
  cookie?: string;

  @IsOptional()
  @IsString()
  proxy?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  crawlAllSkus?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minReviewCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minSalesCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  inStockOnly?: boolean;
}
