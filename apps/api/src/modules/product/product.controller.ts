import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ProductStatus, WbListingStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../auth/auth.types';
import { ProductService } from './product.service';

class ProductQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  catalogOnly?: boolean;

  @IsOptional()
  @IsEnum(WbListingStatus)
  wbListingStatus?: WbListingStatus;

  @IsOptional()
  @IsString()
  categoryPath?: string;

  @IsOptional()
  @IsUUID()
  shopId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  recommended?: boolean;
}

class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  stock?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

class ShelfDto {
  @IsBoolean()
  onShelf: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  shopIds: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  priceMode?:
    | 'keep'
    | 'from_sources'
    | 'dual_times'
    | 'fixed_list_discount'
    | 'fixed_list_sale'
    | 'fixed_sale_discount'
    | 'original_times'
    | 'sale_times'
    | 'fixed';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMultiplier?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  saleMultiplier?: number;

  @IsOptional()
  @IsString()
  listSource?: 'original' | 'discount' | 'sale';

  @IsOptional()
  @IsString()
  saleSource?: 'original' | 'discount' | 'sale';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  listPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  salePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  fixedListPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  fixedSalePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixedDiscountPercent?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skuIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  wbSubjectId?: number;

  @IsOptional()
  @IsString()
  wbSubjectName?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return null;
  })
  @IsBoolean()
  sized?: boolean | null;
}

class BatchShelfDto extends ShelfDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  productIds: string[];
}

class BatchDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @RequirePermissions('product:list')
  page(@CurrentTenantId() tenantId: string | null, @Query() query: ProductQueryDto) {
    return this.productService.page(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('product:list')
  detail(@CurrentTenantId() tenantId: string | null, @Param('id') id: string) {
    return this.productService.detail(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('product:edit')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(tenantId, user.id, id, dto);
  }

  @Post('shelf/batch')
  @RequirePermissions('product:shelf')
  shelfBatch(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: BatchShelfDto,
  ) {
    return this.productService.shelfMany(user, tenantId, dto.productIds, dto);
  }

  @Post('delete/batch')
  @RequirePermissions('product:delete')
  removeBatch(@CurrentTenantId() tenantId: string | null, @Body() dto: BatchDeleteDto) {
    return this.productService.remove(tenantId, dto.ids);
  }

  @Delete(':id')
  @RequirePermissions('product:delete')
  remove(@CurrentTenantId() tenantId: string | null, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.productService.remove(tenantId, [id]);
  }

  @Patch(':id/shelf')
  @RequirePermissions('product:shelf')
  shelf(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Body() dto: ShelfDto,
  ) {
    return this.productService.shelf(user, tenantId, id, dto);
  }
}
