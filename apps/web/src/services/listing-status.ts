import type { Product, ProductShopListing } from './product';

export function isWbListingBusy(status?: Product['wbListingStatus'] | null) {
  return status === 'QUEUED' || status === 'PROCESSING';
}

export function isProductListingBusy(
  product: Pick<Product, 'wbListingStatus' | 'shopListings'>,
): boolean {
  if (isWbListingBusy(product.wbListingStatus)) {
    return true;
  }
  return (product.shopListings || []).some((item) => isWbListingBusy(item.status));
}

export function canShelfProduct(product: Pick<Product, 'status'>) {
  return (
    product.status === 'APPROVED' ||
    product.status === 'OFF_SHELF' ||
    product.status === 'ON_SHELF' ||
    product.status === 'CRAWLED' ||
    product.status === 'AI_PENDING' ||
    product.status === 'AI_DONE' ||
    product.status === 'REVIEW_PENDING'
  );
}

/** 已建卡，或失败但本地已有 nmID（野莓可能残留卡片）才允许下架 */
export function canUnlistListing(listing: Pick<ProductShopListing, 'status' | 'wbNmId'>): boolean {
  if (listing.status === 'LISTED') {
    return true;
  }
  return listing.status === 'FAILED' && listing.wbNmId != null;
}

export function canUnlistProduct(product: Pick<Product, 'shopListings'>): boolean {
  return (product.shopListings || []).some(canUnlistListing);
}

/** 建卡排队/进行中不展示上架；结束后按商品库可上架状态决定 */
export function canShowOnShelfAction(
  product: Pick<Product, 'status' | 'wbListingStatus' | 'shopListings'>,
): boolean {
  return canShelfProduct(product) && !isProductListingBusy(product);
}

/** 建卡排队/进行中不展示下架；结束后仅对已建卡或失败残留 nmID 展示 */
export function canShowOffShelfAction(
  product: Pick<Product, 'wbListingStatus' | 'shopListings'>,
): boolean {
  return !isProductListingBusy(product) && canUnlistProduct(product);
}

/** 上架排队中、已建卡或失败残留 nmID 禁止删除，避免本地删了 WB 卡片还在卖 */
export function canDeleteProduct(
  product: Pick<Product, 'wbListingStatus' | 'shopListings'>,
): boolean {
  if (isProductListingBusy(product)) {
    return false;
  }
  return !(product.shopListings || []).some(canUnlistListing);
}
