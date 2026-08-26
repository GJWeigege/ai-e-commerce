import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { AuthUser } from '../auth/auth.types';
import { OrderService } from './order.service';

class CreateSalesDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  skuId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @MinLength(2)
  receiverName: string;

  @IsString()
  receiverPhone: string;

  @IsString()
  receiverCity: string;

  @IsString()
  receiverAddress: string;

  @IsOptional()
  @IsString()
  receiverRegion?: string;

  @IsOptional()
  @IsString()
  receiverPostalCode?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

class SalesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

class AlertQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}

class BatchIdsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('sales-orders')
  @RequirePermissions('order:list')
  page(@CurrentTenantId() tenantId: string | null, @Query() query: SalesQueryDto) {
    return this.orderService.pageSales(tenantId, query);
  }

  @Post('sales-orders')
  @RequirePermissions('order:create')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: CreateSalesDto,
  ) {
    return this.orderService.createSales(tenantId, user.id, dto);
  }

  @Post('purchase-orders/:id/advance')
  @RequirePermissions('order:batch')
  advance(@CurrentTenantId() tenantId: string | null, @Param('id') id: string, @Body() body: { fail?: boolean }) {
    return this.orderService.advancePurchase(tenantId, id, body.fail);
  }

  @Post('purchase-orders/batch-advance')
  @RequirePermissions('order:batch')
  batch(@CurrentTenantId() tenantId: string | null, @Body() dto: BatchIdsDto) {
    return this.orderService.batchAdvance(tenantId, dto.ids);
  }

  @Get('order-alerts')
  @RequirePermissions('order:alert')
  alerts(@CurrentTenantId() tenantId: string | null, @Query() query: AlertQueryDto) {
    return this.orderService.pageAlerts(tenantId, query);
  }

  @Patch('order-alerts/:id/resolve')
  @RequirePermissions('order:alert')
  resolve(@CurrentUser() user: AuthUser, @CurrentTenantId() tenantId: string | null, @Param('id') id: string) {
    return this.orderService.resolveAlert(tenantId, user.id, id);
  }

  @Get('trace/:salesOrderId')
  @RequirePermissions('order:list')
  trace(@CurrentTenantId() tenantId: string | null, @Param('salesOrderId') salesOrderId: string) {
    return this.orderService.trace(tenantId, salesOrderId);
  }

  @Get('trace')
  @RequirePermissions('order:list')
  traceByNo(@CurrentTenantId() tenantId: string | null, @Query('orderNo') orderNo: string) {
    return this.orderService.traceByOrderNo(tenantId, orderNo);
  }
}
