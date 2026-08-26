import { canUnlistShopListing } from './product-status';

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
