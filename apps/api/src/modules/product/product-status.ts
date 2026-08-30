import { ProductStatus, WbListingStatus } from '@prisma/client';

/** 商品库：采集完成后即可操作，不再经过选品复审 */
export const PRODUCT_CATALOG_STATUSES: ProductStatus[] = [
  'CRAWLED',
  'AI_PENDING',
  'AI_DONE',
  'REVIEW_PENDING',
  'APPROVED',
  'ON_SHELF',
  'OFF_SHELF',
];

export function canListProduct(status: ProductStatus): boolean {
  return PRODUCT_CATALOG_STATUSES.includes(status);
}

/** 已建卡、处理中，或失败但已有 nmID（野莓可能残留卡片）才允许下架 */
export function canUnlistShopListing(listing: { status: WbListingStatus; wbNmId?: bigint | number | null }): boolean {
  if (listing.status === 'LISTED' || listing.status === 'QUEUED' || listing.status === 'PROCESSING') {
    return true;
  }
  return listing.status === 'FAILED' && listing.wbNmId != null;
}
