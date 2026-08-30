export type WbRateLimiterOptions = {
  /** 同一 Token 允许的在途请求数 */
  maxConcurrent?: number;
  /** 相邻请求的最小发起间隔（ms） */
  minIntervalMs?: number;
  /** 命中 429 后的额外间隔上限（ms） */
  maxPenaltyMs?: number;
};

export const DEFAULT_WB_MAX_CONCURRENT = 3;
export const DEFAULT_WB_MIN_INTERVAL_MS = 120;
export const DEFAULT_WB_MAX_PENALTY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * 单 Token 限流闸门：限并发 + 相邻请求最小间隔，429 时自动放大间隔并随成功缓慢回落。
 *
 * 取代此前「同 Token 全部串行」的实现：串行会让批量上架退化成单线程，
 * 一个商品几十次 WB 调用串起来就是分钟级耗时。
 */
export class WbRateLimiter {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly maxPenaltyMs: number;
  private active = 0;
  /** 下一个请求最早可以发起的时间戳，用于把并发请求错峰 */
  private nextAt = 0;
  private penaltyMs = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: WbRateLimiterOptions = {}) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULT_WB_MAX_CONCURRENT));
    this.minIntervalMs = Math.max(0, Math.floor(options.minIntervalMs ?? DEFAULT_WB_MIN_INTERVAL_MS));
    this.maxPenaltyMs = Math.max(0, Math.floor(options.maxPenaltyMs ?? DEFAULT_WB_MAX_PENALTY_MS));
  }

  /** 当前额外惩罚间隔，仅用于观测与单测 */
  get penalty(): number {
    return this.penaltyMs;
  }

  async run<T>(fn: () => Promise<T>, weight = 1): Promise<T> {
    await this.acquire(weight);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 命中 429 时调用：间隔翻倍上浮，抑制后续请求继续踩限流 */
  notifyThrottled(): void {
    this.penaltyMs = Math.min(this.maxPenaltyMs, this.penaltyMs * 2 + this.minIntervalMs + 100);
  }

  /** 请求成功时调用：惩罚间隔线性回落，避免一次 429 长期拖慢整批 */
  notifyOk(): void {
    if (this.penaltyMs > 0) {
      this.penaltyMs = Math.max(0, this.penaltyMs - Math.max(20, Math.floor(this.minIntervalMs / 2)));
    }
  }

  private async acquire(weight: number): Promise<void> {
    while (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;
    const gap = (this.minIntervalMs + this.penaltyMs) * Math.max(1, weight);
    const now = Date.now();
    const startAt = Math.max(now, this.nextAt);
    // 先占住时间片再等待，保证并发调用者不会挤到同一毫秒
    this.nextAt = startAt + gap;
    await sleep(startAt - now);
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

const limiters = new Map<string, WbRateLimiter>();

/** 同一 Token 复用同一个闸门；Token 是 WB 限流的实际维度 */
export function wbRateLimiterForToken(token: string, options?: WbRateLimiterOptions): WbRateLimiter {
  const existing = limiters.get(token);
  if (existing) {
    return existing;
  }
  const created = new WbRateLimiter(options);
  limiters.set(token, created);
  return created;
}

/** 单测用：清空全局闸门注册表 */
export function resetWbRateLimiters(): void {
  limiters.clear();
}
