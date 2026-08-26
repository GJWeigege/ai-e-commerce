import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export const DEFAULT_WB_LISTING_CONCURRENCY = 4;
export const MAX_WB_LISTING_CONCURRENCY = 16;
export const WB_LISTING_SHOP_LOCK_TTL_MS = 15 * 60 * 1000;
export const WB_LISTING_SHOP_LOCK_RETRY_MS = 5000;

/** @Processor 装饰器早于 ConfigModule，这里补读仓库根 .env 里尚未注入的键 */
function ensureEnvFromDotfile() {
  if (process.env.WB_LISTING_CONCURRENCY) {
    return;
  }
  const candidates = [
    resolve(__dirname, '../../../.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] != null) {
        continue;
      }
      process.env[key] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
    return;
  }
}

export function wbListingConcurrencyFromEnv(raw?: string): number {
  if (raw == null) {
    ensureEnvFromDotfile();
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
