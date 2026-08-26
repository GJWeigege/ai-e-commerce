import { ProductStatus, WbListingStatus } from '@prisma/client';

/** 选品复审队列：含采集完成但 AI 尚未出分的记录，避免插件回传后页面空白 */
export const PRODUCT_REVIEW_QUEUE_STATUSES: ProductStatus[] = [
  'CRAWLED',
  'AI_PENDING',
  'AI_DONE',
  'REVIEW_PENDING',
];

export const PRODUCT_CATALOG_STATUSES: ProductStatus[] = ['APPROVED', 'ON_SHELF', 'OFF_SHELF'];

/** 已建卡、处理中，或失败但已有 nmID（野莓可能残留卡片）才允许下架 */
export function canUnlistShopListing(listing: { status: WbListingStatus; wbNmId?: bigint | number | null }): boolean {
  if (listing.status === 'LISTED' || listing.status === 'QUEUED' || listing.status === 'PROCESSING') {
    return true;
  }
  return listing.status === 'FAILED' && listing.wbNmId != null;
}
