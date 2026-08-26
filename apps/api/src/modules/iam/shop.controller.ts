import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PlatformCode } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../auth/auth.types';
import { CreateShopDto, ShopStatusDto, UpdateShopDto } from './dto/shop.dto';
import { ShopService } from './shop.service';

class ShopQueryDto extends PageQueryDto {
  /** 用户分配店铺时一次拉全量，允许比通用分页更大 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 20;

  @IsOptional()
  @IsEnum(PlatformCode)
  platform?: PlatformCode;

  @IsOptional()
  @IsString()
  keyword?: string;

  /** 超管按租户筛选；非超管忽略 */
  @IsOptional()
  @IsString()
  tenantId?: string;

  /** 超管拉全租户店铺（用户授权 / 店铺额度管理）；普通角色忽略 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  allTenants?: boolean;
}

@Controller('shops')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get()
  @RequirePermissions('shop:list')
  page(@CurrentUser() actor: AuthUser, @CurrentTenantId() tenantId: string | null, @Query() query: ShopQueryDto) {
    const scopedTenantId = this.resolveListTenantId(actor, tenantId, query);
    return this.shopService.page(actor, scopedTenantId, query);
  }

  @Get('options')
  @RequirePermissions('shop:list')
  options(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Query('platform') platform?: PlatformCode,
  ) {
    return this.shopService.options(actor, tenantId, platform);
  }

  @Post()
  @RequirePermissions('shop:create')
  create(@CurrentUser() actor: AuthUser, @CurrentTenantId() tenantId: string | null, @Body() dto: CreateShopDto) {
    return this.shopService.create(actor, tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('shop:update')
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.shopService.update(actor, tenantId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('shop:disable')
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Body() dto: ShopStatusDto,
  ) {
    return this.shopService.changeStatus(actor, tenantId, id, dto.status);
  }

  /** 超管可看全部租户店铺，或按 query.tenantId 筛选；租户角色始终锁在当前租户 */
  private resolveListTenantId(
    actor: AuthUser,
    workingTenantId: string | null,
    query: ShopQueryDto,
  ): string | null {
    if (!actor.roles.includes('SUPER_ADMIN')) {
      return workingTenantId;
    }
    if (query.tenantId) {
      return query.tenantId;
    }
    if (query.allTenants) {
      return null;
    }
    return workingTenantId;
  }
}
