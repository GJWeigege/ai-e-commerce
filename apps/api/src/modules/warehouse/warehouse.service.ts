import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { nextBizNo } from '../../common/biz-no';

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  listWarehouses(tenantId: string | null) {
    const tid = requireTenantId(tenantId);
    return this.prisma.warehouse.findMany({
      where: { tenantId: tid, enabled: true },
      orderBy: { type: 'asc' },
    });
  }

  async pageInbound(tenantId: string | null, query: PageQueryDto) {
    const tid = requireTenantId(tenantId);
    const [list, total] = await this.prisma.$transaction([
      this.prisma.inboundRecord.findMany({
        where: { tenantId: tid },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { salesOrder: true, purchaseOrder: true, warehouse: true },
      }),
      this.prisma.inboundRecord.count({ where: { tenantId: tid } }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async inbound(
    tenantId: string | null,
    operatorId: string,
    dto: { purchaseOrderId: string; warehouseId: string; quantity: number; remark?: string },
  ) {
    const tid = requireTenantId(tenantId);
    const purchase = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, tenantId: tid },
      include: { orderLinks: true },
    });
    if (!purchase) {
      throw new NotFoundException('代采订单不存在');
    }
    if (purchase.status !== 'ARRIVED_WB') {
      throw new BadRequestException('仅已到达 WB 官方仓的代采单可转入代发仓');
    }
    const link = purchase.orderLinks[0];
    if (!link) {
      throw new BadRequestException('代采单未关联销售单');
    }
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId: tid, type: 'LOCAL_FULFILLMENT', enabled: true },
    });
    if (!warehouse) {
      throw new NotFoundException('代发仓不存在或未启用');
    }
    if (dto.quantity <= 0 || dto.quantity > purchase.quantity) {
      throw new BadRequestException('入库数量不合法');
    }

    const record = await this.prisma.inboundRecord.create({
      data: {
        tenantId: tid,
        warehouseId: warehouse.id,
        orderLinkId: link.id,
        purchaseOrderId: purchase.id,
        salesOrderId: link.salesOrderId,
        inboundNo: nextBizNo('IN'),
        quantity: dto.quantity,
        operatorId,
        inboundAt: new Date(),
        remark: dto.remark,
      },
    });
    await this.prisma.salesOrder.update({
      where: { id: link.salesOrderId },
      data: { status: 'INBOUND' },
    });
    await this.prisma.logisticsTrack.create({
      data: {
        tenantId: tid,
        relatedType: 'SALES_ORDER',
        relatedId: link.salesOrderId,
        nodeCode: 'WH_INBOUND',
        nodeName: '代发仓入库',
        description: `入库单 ${record.inboundNo}，绑定代采 ${purchase.purchaseNo}`,
        occurredAt: new Date(),
      },
    });
    return record;
  }

  async pageOutbound(tenantId: string | null, query: PageQueryDto) {
    const tid = requireTenantId(tenantId);
    const [list, total] = await this.prisma.$transaction([
      this.prisma.outboundRecord.findMany({
        where: { tenantId: tid },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { salesOrder: true, warehouse: true },
      }),
      this.prisma.outboundRecord.count({ where: { tenantId: tid } }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async outbound(
    tenantId: string | null,
    operatorId: string,
    dto: { inboundRecordId: string; trackingNo: string; carrier?: string; quantity?: number; remark?: string },
  ) {
    const tid = requireTenantId(tenantId);
    const inbound = await this.prisma.inboundRecord.findFirst({
      where: { id: dto.inboundRecordId, tenantId: tid },
    });
    if (!inbound) {
      throw new NotFoundException('入库记录不存在');
    }
    const dup = await this.prisma.outboundRecord.findFirst({
      where: { tenantId: tid, trackingNo: dto.trackingNo },
    });
    if (dup) {
      throw new BadRequestException('物流单号已存在');
    }
    const qty = dto.quantity ?? inbound.quantity;
    const record = await this.prisma.outboundRecord.create({
      data: {
        tenantId: tid,
        warehouseId: inbound.warehouseId,
        inboundRecordId: inbound.id,
        salesOrderId: inbound.salesOrderId,
        quantity: qty,
        trackingNo: dto.trackingNo,
        carrier: dto.carrier,
        operatorId,
        outboundAt: new Date(),
        remark: dto.remark,
      },
    });
    await this.prisma.salesOrder.update({
      where: { id: inbound.salesOrderId },
      data: {
        status: 'SHIPPED',
        outboundTrackingNo: dto.trackingNo,
        outboundCarrier: dto.carrier,
      },
    });
    await this.prisma.logisticsTrack.create({
      data: {
        tenantId: tid,
        relatedType: 'SALES_ORDER',
        relatedId: inbound.salesOrderId,
        nodeCode: 'WH_OUTBOUND',
        nodeName: '代发仓出库',
        description: `物流单号 ${dto.trackingNo}`,
        occurredAt: new Date(),
      },
    });
    return record;
  }
}
