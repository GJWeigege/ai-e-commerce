import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions, SkipTenant } from '../../common/decorators/auth.decorators';
import { ChangeTenantStatusDto } from './dto/change-tenant-status.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantPageQueryDto } from './dto/tenant-page-query.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantService } from './tenant.service';

@Controller('tenants')
@SkipTenant()
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @RequirePermissions('tenant:list')
  page(@Query() query: TenantPageQueryDto) {
    return this.tenantService.page(query);
  }

  @Get('options')
  @RequirePermissions('tenant:list')
  async options() {
    const result = await this.tenantService.page({ page: 1, pageSize: 100, status: 'ACTIVE' });
    return result.list;
  }

  @Get(':id')
  @RequirePermissions('tenant:list')
  detail(@Param('id') id: string) {
    return this.tenantService.findById(id);
  }

  @Post()
  @RequirePermissions('tenant:create')
  create(@Body() dto: CreateTenantDto) {
    return this.tenantService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('tenant:update')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('tenant:disable')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeTenantStatusDto) {
    return this.tenantService.changeStatus(id, dto.status);
  }
}
