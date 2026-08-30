import { loadRootEnv } from '../common/security/load-root-env';

export const DEFAULT_WB_LISTING_CONCURRENCY = 8;
export const MAX_WB_LISTING_CONCURRENCY = 16;
export const DEFAULT_WB_LISTING_SHOP_CONCURRENCY = 4;
export const MAX_WB_LISTING_SHOP_CONCURRENCY = 8;
export const WB_LISTING_SHOP_LOCK_TTL_MS = 15 * 60 * 1000;
export const WB_LISTING_SHOP_LOCK_RETRY_MS = 2000;

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

/**
 * 单店铺同时可跑几个上架任务。
 * 此前是独占锁（等价于 1），多数租户只有一个 WB 店铺，导致 worker 并发形同虚设、
 * 批量上架只能一个一个排队；WB 侧真正的瓶颈是 Token 限流，已由 WbRateLimiter 兜住。
 */
export function wbListingShopConcurrencyFromEnv(raw?: string): number {
  if (raw == null) {
    loadRootEnv();
    raw = process.env.WB_LISTING_SHOP_CONCURRENCY;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_WB_LISTING_SHOP_CONCURRENCY;
  }
  return Math.min(MAX_WB_LISTING_SHOP_CONCURRENCY, Math.floor(n));
}

export function shopListingLockKey(shopId: string, slot = 0): string {
  return `wb-listing:shop:${shopId}:${slot}`;
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

/** 店铺级信号量：slots 个槽位，抢到任意一个即可开工 */
export class ShopListingLock {
  private readonly slots: number;

  constructor(
    private readonly store: ListingLockStore,
    private readonly ttlMs = WB_LISTING_SHOP_LOCK_TTL_MS,
    slots?: number,
  ) {
    this.slots = Math.max(1, Math.floor(slots ?? wbListingShopConcurrencyFromEnv()));
  }

  async acquire(shopId: string, owner: string): Promise<boolean> {
    for (let slot = 0; slot < this.slots; slot += 1) {
      if (await this.store.acquire(shopListingLockKey(shopId, slot), owner, this.ttlMs)) {
        return true;
      }
    }
    return false;
  }

  /** 释放按 owner 校验，逐个槽位尝试即可，不必记住抢到的是哪个槽 */
  async release(shopId: string, owner: string): Promise<void> {
    for (let slot = 0; slot < this.slots; slot += 1) {
      await this.store.release(shopListingLockKey(shopId, slot), owner);
    }
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
