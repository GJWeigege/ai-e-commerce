import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../auth/auth.types';
import { WarehouseService } from './warehouse.service';

class InboundDto {
  @IsString()
  purchaseOrderId: string;

  @IsString()
  warehouseId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

class OutboundDto {
  @IsString()
  inboundRecordId: string;

  @IsString()
  @MinLength(4)
  trackingNo: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('options')
  @RequirePermissions('warehouse:inbound')
  options(@CurrentTenantId() tenantId: string | null) {
    return this.warehouseService.listWarehouses(tenantId);
  }

  @Get('inbounds')
  @RequirePermissions('warehouse:inbound')
  inbounds(@CurrentTenantId() tenantId: string | null, @Query() query: PageQueryDto) {
    return this.warehouseService.pageInbound(tenantId, query);
  }

  @Post('inbounds')
  @RequirePermissions('warehouse:inbound')
  inbound(@CurrentUser() user: AuthUser, @CurrentTenantId() tenantId: string | null, @Body() dto: InboundDto) {
    return this.warehouseService.inbound(tenantId, user.id, dto);
  }

  @Get('outbounds')
  @RequirePermissions('warehouse:outbound')
  outbounds(@CurrentTenantId() tenantId: string | null, @Query() query: PageQueryDto) {
    return this.warehouseService.pageOutbound(tenantId, query);
  }

  @Post('outbounds')
  @RequirePermissions('warehouse:outbound')
  outbound(@CurrentUser() user: AuthUser, @CurrentTenantId() tenantId: string | null, @Body() dto: OutboundDto) {
    return this.warehouseService.outbound(tenantId, user.id, dto);
  }
}
