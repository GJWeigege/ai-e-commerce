import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { StubOzonAdapter, StubWbAdapter } from '@aiecom/platform-core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { nextBizNo } from '../../common/biz-no';
import { advancePurchaseStatus, purchaseTrackNode, salesStatusForPurchase } from './order-status';

@Injectable()
export class OrderService {
  private readonly ozon = new StubOzonAdapter();
  private readonly wb = new StubWbAdapter();

  constructor(private readonly prisma: PrismaService) {}

  async pageSales(tenantId: string | null, query: PageQueryDto & { status?: string; keyword?: string }): Promise<PageResult<unknown>> {
    const tid = requireTenantId(tenantId);
    const where: Prisma.SalesOrderWhereInput = {
      tenantId: tid,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.keyword
        ? {
            OR: [
              { orderNo: { contains: query.keyword, mode: 'insensitive' } },
              { skuId: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { name: true, skuId: true, status: true } },
          orderLinks: { include: { purchaseOrder: true } },
        },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async createSales(
    tenantId: string | null,
    userId: string,
    dto: {
      productId: string;
      skuId?: string;
      quantity: number;
      receiverName: string;
      receiverPhone: string;
      receiverCity: string;
      receiverAddress: string;
      receiverRegion?: string;
      receiverPostalCode?: string;
      remark?: string;
    },
  ) {
    const tid = requireTenantId(tenantId);
    if (dto.quantity <= 0) {
      throw new BadRequestException('数量必须大于 0');
    }
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId: tid } });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    if (product.status !== 'ON_SHELF') {
      throw new BadRequestException('仅上架商品可创建销售订单');
    }

    const skuOptions = Array.isArray(product.skuOptions)
      ? (product.skuOptions as Array<{ skuId?: string }>)
      : [];
    const skuId = dto.skuId || product.skuId;
    if (skuOptions.length && !skuOptions.some((item) => item.skuId === skuId) && skuId !== product.skuId) {
      throw new BadRequestException('所选规格不属于该商品');
    }

    const sales = await this.prisma.salesOrder.create({
      data: {
        tenantId: tid,
        createdById: userId,
        orderNo: nextBizNo('SO'),
        productId: product.id,
        skuId,
        quantity: dto.quantity,
        receiverName: dto.receiverName,
        receiverPhone: dto.receiverPhone,
        receiverCity: dto.receiverCity,
        receiverAddress: dto.receiverAddress,
        receiverRegion: dto.receiverRegion,
        receiverPostalCode: dto.receiverPostalCode,
        remark: dto.remark,
        status: 'PURCHASE_PENDING',
      },
    });

    const purchase = await this.prisma.purchaseOrder.create({
      data: {
        tenantId: tid,
        purchaseNo: nextBizNo('PO'),
        skuId,
        quantity: dto.quantity,
        status: 'PENDING_PURCHASE',
      },
    });

    await this.prisma.orderLink.create({
      data: {
        tenantId: tid,
        salesOrderId: sales.id,
        purchaseOrderId: purchase.id,
        skuId,
        quantity: dto.quantity,
      },
    });

    await this.addTrack(tid, 'SALES_ORDER', sales.id, 'SO_CREATED', '销售订单已创建', `数量 ${dto.quantity}`);
    await this.addTrack(tid, 'PURCHASE_ORDER', purchase.id, 'PO_PENDING', '待采购', `自动生成代采单 ${purchase.purchaseNo}`);
    return this.prisma.salesOrder.findUnique({
      where: { id: sales.id },
      include: { orderLinks: { include: { purchaseOrder: true } } },
    });
  }

  async advancePurchase(tenantId: string | null, purchaseId: string, fail?: boolean): Promise<unknown> {
    const tid = requireTenantId(tenantId);
    const purchase = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseId, tenantId: tid },
      include: { orderLinks: true },
    });
    if (!purchase) {
      throw new NotFoundException('代采订单不存在');
    }

    if (fail) {
      if (purchase.status !== 'PENDING_PURCHASE') {
        throw new BadRequestException('仅待采购状态可标记失败');
      }
      await this.prisma.purchaseOrder.update({
        where: { id: purchase.id },
        data: { status: 'PURCHASE_FAILED', failReason: 'Ozon 代采失败（模拟）' },
      });
      await this.syncSales(purchase.orderLinks.map((link) => link.salesOrderId), 'PURCHASE_FAILED');
      await this.addTrack(tid, 'PURCHASE_ORDER', purchase.id, 'PO_FAILED', '采购失败', 'Ozon Adapter 返回失败');
      await this.prisma.orderAlert.create({
        data: {
          tenantId: tid,
          relatedType: 'PURCHASE_ORDER',
          relatedId: purchase.id,
          level: 'ERROR',
          type: 'PURCHASE_FAILED',
          title: '代采失败',
          message: `${purchase.purchaseNo} 采购失败，请重试或改派`,
        },
      });
      return this.prisma.purchaseOrder.findUnique({ where: { id: purchase.id } });
    }

    const next = advancePurchaseStatus(purchase.status);
    if (!next) {
      throw new BadRequestException('当前状态不可推进');
    }

    const extra: Prisma.PurchaseOrderUpdateInput = { status: next };
    if (next === 'PURCHASE_SUCCESS') {
      const placed = await this.ozon.placePurchase({
        skuId: purchase.skuId,
        quantity: purchase.quantity,
        credentialRef: process.env.OZON_CREDENTIAL_REF || 'OZON_API_KEY',
      });
      if (!placed.success) {
        return this.advancePurchase(tenantId, purchaseId, true);
      }
      extra.ozonOrderNo = placed.ozonOrderNo;
    }
    if (next === 'SHIPPED_TO_WB' && purchase.ozonOrderNo) {
      const transfer = await this.wb.createTransfer({ ozonOrderNo: purchase.ozonOrderNo, quantity: purchase.quantity });
      extra.wbTrackingNo = transfer.wbTrackingNo;
    }

    await this.prisma.purchaseOrder.update({ where: { id: purchase.id }, data: extra });
    const node = purchaseTrackNode(next);
    await this.addTrack(tid, 'PURCHASE_ORDER', purchase.id, node.code, node.name, `状态变更为 ${next}`);
    await this.syncSales(purchase.orderLinks.map((link) => link.salesOrderId), next);
    return this.prisma.purchaseOrder.findUnique({ where: { id: purchase.id } });
  }

  async batchAdvance(tenantId: string | null, purchaseIds: string[]) {
    const results = [];
    for (const id of purchaseIds) {
      results.push(await this.advancePurchase(tenantId, id));
    }
    return { count: results.length };
  }

  async pageAlerts(tenantId: string | null, query: PageQueryDto & { status?: string }) {
    const tid = requireTenantId(tenantId);
    const where: Prisma.OrderAlertWhereInput = {
      tenantId: tid,
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.orderAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.orderAlert.count({ where }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async resolveAlert(tenantId: string | null, userId: string, id: string) {
    const tid = requireTenantId(tenantId);
    const alert = await this.prisma.orderAlert.findFirst({ where: { id, tenantId: tid } });
    if (!alert) {
      throw new NotFoundException('告警不存在');
    }
    return this.prisma.orderAlert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: userId, resolvedAt: new Date() },
    });
  }

  async trace(tenantId: string | null, salesOrderId: string) {
    const tid = requireTenantId(tenantId);
    const sales = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId: tid },
      include: {
        product: true,
        orderLinks: { include: { purchaseOrder: true, inbounds: { include: { outbounds: true, warehouse: true } } } },
        inbounds: true,
        outbounds: true,
      },
    });
    if (!sales) {
      throw new NotFoundException('销售订单不存在');
    }
    const purchaseIds = sales.orderLinks.map((link) => link.purchaseOrderId);
    const tracks = await this.prisma.logisticsTrack.findMany({
      where: {
        tenantId: tid,
        OR: [
          { relatedType: 'SALES_ORDER', relatedId: sales.id },
          { relatedType: 'PURCHASE_ORDER', relatedId: { in: purchaseIds } },
        ],
      },
      orderBy: { occurredAt: 'asc' },
    });
    const alerts = await this.prisma.orderAlert.findMany({
      where: {
        tenantId: tid,
        OR: [
          { relatedType: 'SALES_ORDER', relatedId: sales.id },
          { relatedType: 'PURCHASE_ORDER', relatedId: { in: purchaseIds } },
        ],
      },
    });
    return { sales, tracks, alerts };
  }

  async traceByOrderNo(tenantId: string | null, orderNo: string) {
    if (!orderNo) {
      throw new BadRequestException('请提供销售单号 orderNo');
    }
    const tid = requireTenantId(tenantId);
    const sales = await this.prisma.salesOrder.findFirst({ where: { tenantId: tid, orderNo } });
    if (!sales) {
      throw new NotFoundException('销售订单不存在');
    }
    return this.trace(tenantId, sales.id);
  }

  private async syncSales(salesIds: string[], purchaseStatus: PurchaseOrderStatus) {
    const status = salesStatusForPurchase(purchaseStatus);
    await this.prisma.salesOrder.updateMany({
      where: { id: { in: salesIds } },
      data: { status },
    });
  }

  private async addTrack(
    tenantId: string,
    relatedType: 'SALES_ORDER' | 'PURCHASE_ORDER',
    relatedId: string,
    nodeCode: string,
    nodeName: string,
    description: string,
  ) {
    await this.prisma.logisticsTrack.create({
      data: { tenantId, relatedType, relatedId, nodeCode, nodeName, description, occurredAt: new Date() },
    });
  }
}
