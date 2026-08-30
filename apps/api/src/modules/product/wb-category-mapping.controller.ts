import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../auth/auth.types';
import { WbCategoryMappingService } from './wb-category-mapping.service';

class WbCategoryMappingQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}

class UpsertWbCategoryMappingDto {
  @IsString()
  ozonCategoryPath: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  wbSubjectId: number;

  @IsString()
  wbSubjectName: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return null;
  })
  @IsBoolean()
  sized?: boolean | null;

  @IsOptional()
  @IsString()
  remark?: string;
}

class ResolveWbCategoryMappingQueryDto {
  @IsOptional()
  @IsString()
  ozonCategoryPath?: string;
}

class SuggestWbSubjectDto {
  @IsUUID()
  shopId: string;

  @IsOptional()
  @IsString()
  ozonCategoryPath?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  productName?: string;
}

class BatchDeleteWbCategoryMappingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

@Controller('wb-category-mappings')
export class WbCategoryMappingController {
  constructor(private readonly service: WbCategoryMappingService) {}

  @Get()
  @RequirePermissions('product:list')
  page(@CurrentTenantId() tenantId: string | null, @Query() query: WbCategoryMappingQueryDto) {
    return this.service.page(tenantId, query);
  }

  @Get('ozon-categories')
  @RequirePermissions('product:list')
  ozonCategories(@CurrentTenantId() tenantId: string | null) {
    return this.service.ozonCategories(tenantId);
  }

  @Get('resolve')
  @RequirePermissions('product:list')
  resolveByPath(
    @CurrentTenantId() tenantId: string | null,
    @Query() query: ResolveWbCategoryMappingQueryDto,
  ) {
    return this.service.findByPath(tenantId, query.ozonCategoryPath);
  }

  @Post('suggest')
  @RequirePermissions('product:shelf')
  suggest(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: SuggestWbSubjectDto,
  ) {
    return this.service.suggest(user, tenantId, dto);
  }

  @Post()
  @RequirePermissions('product:shelf')
  upsert(@CurrentTenantId() tenantId: string | null, @Body() dto: UpsertWbCategoryMappingDto) {
    return this.service.upsert(tenantId, dto);
  }

  @Post('delete/batch')
  @RequirePermissions('product:shelf')
  removeBatch(@CurrentTenantId() tenantId: string | null, @Body() dto: BatchDeleteWbCategoryMappingDto) {
    return this.service.remove(tenantId, dto.ids);
  }

  @Delete(':id')
  @RequirePermissions('product:shelf')
  remove(@CurrentTenantId() tenantId: string | null, @Param('id') id: string) {
    return this.service.remove(tenantId, [id]);
  }
}
