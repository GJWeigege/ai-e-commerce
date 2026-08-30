import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from './common/decorators/auth.decorators';
import { CurrentTenantId } from './common/decorators/current.decorators';
import { PrismaService } from './common/prisma/prisma.service';
import { PRODUCT_CATALOG_STATUSES } from './modules/product/product-status';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  @RequirePermissions('menu:dashboard')
  async stats(@CurrentTenantId() tenantId: string | null) {
    if (!tenantId) {
      return { tasks: 0, products: 0, onShelf: 0, sales: 0, openAlerts: 0, needTenant: true };
    }
    const [tasks, products, onShelf, sales, openAlerts] = await Promise.all([
      this.prisma.crawlerTask.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId, status: { in: PRODUCT_CATALOG_STATUSES } } }),
      this.prisma.product.count({ where: { tenantId, status: 'ON_SHELF' } }),
      this.prisma.salesOrder.count({ where: { tenantId } }),
      this.prisma.orderAlert.count({ where: { tenantId, status: 'OPEN' } }),
    ]);
    return { tasks, products, onShelf, sales, openAlerts };
  }
}
