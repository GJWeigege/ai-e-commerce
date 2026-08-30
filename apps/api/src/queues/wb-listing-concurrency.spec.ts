import {
  MemoryListingLockStore,
  ShopListingLock,
  WB_LISTING_SHOP_LOCK_TTL_MS,
  beginShopListing,
  wbListingConcurrencyFromEnv,
  wbListingShopConcurrencyFromEnv,
} from './wb-listing-concurrency';

function lockWithSlots(slots: number) {
  return new ShopListingLock(new MemoryListingLockStore(), WB_LISTING_SHOP_LOCK_TTL_MS, slots);
}

describe('wb listing concurrency', () => {
  it('defaults to 8 and clamps invalid or oversized values', () => {
    expect(wbListingConcurrencyFromEnv(undefined)).toBe(8);
    expect(wbListingConcurrencyFromEnv('')).toBe(8);
    expect(wbListingConcurrencyFromEnv('0')).toBe(8);
    expect(wbListingConcurrencyFromEnv('-2')).toBe(8);
    expect(wbListingConcurrencyFromEnv('3')).toBe(3);
    expect(wbListingConcurrencyFromEnv('99')).toBe(16);
  });

  it('defaults shop level concurrency to 4 and clamps it to 8', () => {
    expect(wbListingShopConcurrencyFromEnv('')).toBe(4);
    expect(wbListingShopConcurrencyFromEnv('0')).toBe(4);
    expect(wbListingShopConcurrencyFromEnv('2')).toBe(2);
    expect(wbListingShopConcurrencyFromEnv('99')).toBe(8);
  });

  it('lets different shops run at the same time but serializes the same shop when only one slot exists', async () => {
    const lock = lockWithSlots(1);

    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-2')).toBe('delay');
    expect(await beginShopListing(lock, 'shop-b', 'job-3')).toBe('run');

    await lock.release('shop-a', 'job-1');
    expect(await beginShopListing(lock, 'shop-a', 'job-2')).toBe('run');
  });

  it('runs several jobs per shop up to the slot count and delays the rest', async () => {
    const lock = lockWithSlots(3);

    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-2')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-3')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-4')).toBe('delay');

    await lock.release('shop-a', 'job-2');
    expect(await beginShopListing(lock, 'shop-a', 'job-4')).toBe('run');
  });

  it('does not release a shop slot owned by another job', async () => {
    const lock = lockWithSlots(1);
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    await lock.release('shop-a', 'job-2');
    expect(await beginShopListing(lock, 'shop-a', 'job-3')).toBe('delay');
  });

  it('lets the same job refresh its own shop slot', async () => {
    const lock = lockWithSlots(2);
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
  });
});
