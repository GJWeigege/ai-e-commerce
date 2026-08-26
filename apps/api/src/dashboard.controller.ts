import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from './common/decorators/auth.decorators';
import { CurrentTenantId } from './common/decorators/current.decorators';
import { PrismaService } from './common/prisma/prisma.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stats')
  @RequirePermissions('menu:dashboard')
  async stats(@CurrentTenantId() tenantId: string | null) {
    if (!tenantId) {
      return { tasks: 0, products: 0, pendingReview: 0, onShelf: 0, sales: 0, openAlerts: 0, needTenant: true };
    }
    const [tasks, products, pendingReview, onShelf, sales, openAlerts] = await Promise.all([
      this.prisma.crawlerTask.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId, status: { in: ['REVIEW_PENDING', 'AI_DONE'] } } }),
      this.prisma.product.count({ where: { tenantId, status: 'ON_SHELF' } }),
      this.prisma.salesOrder.count({ where: { tenantId } }),
      this.prisma.orderAlert.count({ where: { tenantId, status: 'OPEN' } }),
    ]);
    return { tasks, products, pendingReview, onShelf, sales, openAlerts };
  }
}
