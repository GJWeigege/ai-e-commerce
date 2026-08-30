import { canListProduct, canUnlistShopListing, PRODUCT_CATALOG_STATUSES } from './product-status';

describe('canUnlistShopListing', () => {
  it('allows listed and in-flight jobs', () => {
    expect(canUnlistShopListing({ status: 'LISTED', wbNmId: 1n })).toBe(true);
    expect(canUnlistShopListing({ status: 'QUEUED', wbNmId: null })).toBe(true);
    expect(canUnlistShopListing({ status: 'PROCESSING', wbNmId: null })).toBe(true);
  });

  it('allows failed listings only when a WB nmID exists', () => {
    expect(canUnlistShopListing({ status: 'FAILED', wbNmId: 1471419881n })).toBe(true);
    expect(canUnlistShopListing({ status: 'FAILED', wbNmId: null })).toBe(false);
  });

  it('rejects never-listed or already unlisted records', () => {
    expect(canUnlistShopListing({ status: 'NONE', wbNmId: null })).toBe(false);
    expect(canUnlistShopListing({ status: 'UNLISTED', wbNmId: 1n })).toBe(false);
  });
});

describe('product catalog statuses', () => {
  it('lets crawled products enter the catalog without an approve hop', () => {
    expect(PRODUCT_CATALOG_STATUSES).toEqual(
      expect.arrayContaining(['CRAWLED', 'AI_PENDING', 'APPROVED', 'ON_SHELF', 'OFF_SHELF']),
    );
    expect(canListProduct('CRAWLED')).toBe(true);
    expect(canListProduct('APPROVED')).toBe(true);
    expect(canListProduct('REJECTED')).toBe(false);
  });
});
