import { PurchaseOrderStatus, SalesOrderStatus } from '@prisma/client';

export function advancePurchaseStatus(current: PurchaseOrderStatus): PurchaseOrderStatus | null {
  const flow: Record<string, PurchaseOrderStatus> = {
    PENDING_PURCHASE: 'PURCHASE_SUCCESS',
    PURCHASE_SUCCESS: 'SHIPPED_TO_WB',
    SHIPPED_TO_WB: 'ARRIVED_WB',
  };
  return flow[current] ?? null;
}

export function salesStatusForPurchase(status: PurchaseOrderStatus): SalesOrderStatus {
  switch (status) {
    case 'PENDING_PURCHASE':
      return 'PURCHASE_PENDING';
    case 'PURCHASE_SUCCESS':
      return 'PURCHASING';
    case 'PURCHASE_FAILED':
      return 'EXCEPTION';
    case 'SHIPPED_TO_WB':
      return 'IN_TRANSIT_WB';
    case 'ARRIVED_WB':
      return 'ARRIVED_WB';
    default:
      return 'EXCEPTION';
  }
}

export function purchaseTrackNode(status: PurchaseOrderStatus): { code: string; name: string } {
  switch (status) {
    case 'PENDING_PURCHASE':
      return { code: 'PO_PENDING', name: '待采购' };
    case 'PURCHASE_SUCCESS':
      return { code: 'PO_SUCCESS', name: '采购成功' };
    case 'PURCHASE_FAILED':
      return { code: 'PO_FAILED', name: '采购失败' };
    case 'SHIPPED_TO_WB':
      return { code: 'PO_TO_WB', name: '已发货至 WB 仓' };
    case 'ARRIVED_WB':
      return { code: 'PO_ARRIVED_WB', name: '已到达 WB 官方仓' };
    default:
      return { code: status, name: status };
  }
}
