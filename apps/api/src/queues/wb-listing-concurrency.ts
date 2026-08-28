import { loadRootEnv } from '../common/security/load-root-env';

export const DEFAULT_WB_LISTING_CONCURRENCY = 4;
export const MAX_WB_LISTING_CONCURRENCY = 16;
export const WB_LISTING_SHOP_LOCK_TTL_MS = 15 * 60 * 1000;
export const WB_LISTING_SHOP_LOCK_RETRY_MS = 5000;

export function wbListingConcurrencyFromEnv(raw?: string): number {
  if (raw == null) {
    loadRootEnv();
    raw = process.env.WB_LISTING_CONCURRENCY;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_WB_LISTING_CONCURRENCY;
  }
  return Math.min(MAX_WB_LISTING_CONCURRENCY, Math.floor(n));
}

export function shopListingLockKey(shopId: string): string {
  return `wb-listing:shop:${shopId}`;
}

export type ListingLockStore = {
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
};

type MemoryLock = {
  owner: string;
  expiresAt: number;
};

/** 单测用内存锁，语义对齐 Redis SET key NX PX */
export class MemoryListingLockStore implements ListingLockStore {
  private readonly locks = new Map<string, MemoryLock>();

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.locks.get(key);
    if (current && current.expiresAt > now && current.owner !== owner) {
      return false;
    }
    this.locks.set(key, { owner, expiresAt: now + ttlMs });
    return true;
  }

  async release(key: string, owner: string): Promise<void> {
    const current = this.locks.get(key);
    if (current?.owner === owner) {
      this.locks.delete(key);
    }
  }
}

export class ShopListingLock {
  constructor(
    private readonly store: ListingLockStore,
    private readonly ttlMs = WB_LISTING_SHOP_LOCK_TTL_MS,
  ) {}

  acquire(shopId: string, owner: string): Promise<boolean> {
    return this.store.acquire(shopListingLockKey(shopId), owner, this.ttlMs);
  }

  release(shopId: string, owner: string): Promise<void> {
    return this.store.release(shopListingLockKey(shopId), owner);
  }
}

export async function beginShopListing(
  lock: ShopListingLock,
  shopId: string,
  jobId: string,
): Promise<'run' | 'delay'> {
  const acquired = await lock.acquire(shopId, jobId);
  return acquired ? 'run' : 'delay';
}
