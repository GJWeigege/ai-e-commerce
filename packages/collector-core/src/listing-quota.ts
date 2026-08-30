import { pickOzonProductUrls } from './ozon-urls';

const MAX_TOP_N = 50;
const MAX_HARVEST = 600;
const HARVEST_MULTIPLIER = 12;

/** 品类页要多拆候选：详情过滤后达标率可能只有约一成，才能补齐到 TOP N */
export function listingHarvestLimit(topN: number): number {
  const n = clampTopN(topN);
  return Math.min(MAX_HARVEST, Math.max(n * HARVEST_MULTIPLIER, n + 16));
}

export function splitListingQueue(
  rawUrls: string[],
  topN: number,
  listingUrl?: string,
): { immediate: string[]; pool: string[] } {
  const harvested = pickOzonProductUrls(
    rawUrls.filter((url) => url !== listingUrl),
    listingHarvestLimit(topN),
  );
  const n = clampTopN(topN);
  return {
    immediate: harvested.slice(0, n),
    pool: harvested.slice(n),
  };
}

export function listingQuotaDeficit(topN: number, counts: { success: number; inFlight: number }): number {
  return Math.max(0, clampTopN(topN) - Math.max(0, counts.success) - Math.max(0, counts.inFlight));
}

/** 从候选池取出下一批尚未建明细的商品链接 */
export function nextListingBackfill(
  pool: string[],
  existingUrls: string[],
  need: number,
): { next: string[]; remaining: string[] } {
  if (need <= 0) {
    return { next: [], remaining: uniqueProductUrls(pool) };
  }
  const seen = new Set(uniqueProductUrls(existingUrls));
  const next: string[] = [];
  const remaining: string[] = [];
  for (const url of uniqueProductUrls(pool)) {
    if (seen.has(url)) {
      continue;
    }
    if (next.length < need) {
      next.push(url);
      seen.add(url);
    } else {
      remaining.push(url);
    }
  }
  return { next, remaining };
}

function clampTopN(topN: number): number {
  const n = Math.floor(Number(topN) || 0);
  return Math.min(MAX_TOP_N, Math.max(1, n));
}

function uniqueProductUrls(raw: string[]): string[] {
  return pickOzonProductUrls(raw, Math.max(MAX_HARVEST, raw.length));
}
