import { WbRateLimiter, resetWbRateLimiters, wbRateLimiterForToken } from '@aiecom/platform-core';

describe('wb rate limiter', () => {
  afterEach(() => resetWbRateLimiters());

  it('runs requests in parallel up to the concurrency limit', async () => {
    const limiter = new WbRateLimiter({ maxConcurrent: 3, minIntervalMs: 0 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    await Promise.all(Array.from({ length: 9 }, () => limiter.run(task)));

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('spaces out consecutive requests by the minimum interval', async () => {
    const limiter = new WbRateLimiter({ maxConcurrent: 4, minIntervalMs: 30 });
    const startedAt: number[] = [];

    await Promise.all(
      Array.from({ length: 3 }, () =>
        limiter.run(async () => {
          startedAt.push(Date.now());
        }),
      ),
    );

    startedAt.sort((left, right) => left - right);
    // 允许定时器抖动，只校验没有挤在同一毫秒发出
    expect(startedAt[2] - startedAt[0]).toBeGreaterThanOrEqual(45);
  });

  it('grows the penalty on 429 and decays it back on success', () => {
    const limiter = new WbRateLimiter({ maxConcurrent: 1, minIntervalMs: 100 });
    expect(limiter.penalty).toBe(0);

    limiter.notifyThrottled();
    const first = limiter.penalty;
    expect(first).toBeGreaterThan(0);

    limiter.notifyThrottled();
    expect(limiter.penalty).toBeGreaterThan(first);

    const beforeDecay = limiter.penalty;
    limiter.notifyOk();
    expect(limiter.penalty).toBeLessThan(beforeDecay);
  });

  it('caps the penalty so one throttled batch cannot stall the queue', () => {
    const limiter = new WbRateLimiter({ maxConcurrent: 1, minIntervalMs: 100, maxPenaltyMs: 500 });
    for (let i = 0; i < 20; i += 1) {
      limiter.notifyThrottled();
    }
    expect(limiter.penalty).toBe(500);
  });

  it('reuses one limiter per token because WB throttles by token', () => {
    const first = wbRateLimiterForToken('token-a');
    expect(wbRateLimiterForToken('token-a')).toBe(first);
    expect(wbRateLimiterForToken('token-b')).not.toBe(first);
  });
});
