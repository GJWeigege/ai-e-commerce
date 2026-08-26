import {
  MemoryListingLockStore,
  ShopListingLock,
  beginShopListing,
  wbListingConcurrencyFromEnv,
} from './wb-listing-concurrency';

describe('wb listing concurrency', () => {
  it('defaults to 4 and clamps invalid or oversized values', () => {
    expect(wbListingConcurrencyFromEnv(undefined)).toBe(4);
    expect(wbListingConcurrencyFromEnv('')).toBe(4);
    expect(wbListingConcurrencyFromEnv('0')).toBe(4);
    expect(wbListingConcurrencyFromEnv('-2')).toBe(4);
    expect(wbListingConcurrencyFromEnv('3')).toBe(3);
    expect(wbListingConcurrencyFromEnv('99')).toBe(16);
  });

  it('lets different shops run at the same time but serializes the same shop', async () => {
    const lock = new ShopListingLock(new MemoryListingLockStore());

    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-2')).toBe('delay');
    expect(await beginShopListing(lock, 'shop-b', 'job-3')).toBe('run');

    await lock.release('shop-a', 'job-1');
    expect(await beginShopListing(lock, 'shop-a', 'job-2')).toBe('run');
  });

  it('does not release a shop lock owned by another job', async () => {
    const lock = new ShopListingLock(new MemoryListingLockStore());
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    await lock.release('shop-a', 'job-2');
    expect(await beginShopListing(lock, 'shop-a', 'job-3')).toBe('delay');
  });

  it('lets the same job refresh its own shop lock', async () => {
    const lock = new ShopListingLock(new MemoryListingLockStore());
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
    expect(await beginShopListing(lock, 'shop-a', 'job-1')).toBe('run');
  });
});
