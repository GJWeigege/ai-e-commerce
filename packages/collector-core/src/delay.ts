/** 采集端 pollBusy 超过此时长仍未回写，服务端把 RUNNING 放回领取队列 */
export const POLL_STUCK_MS = 180_000;

export function randomDelayMs(minMs: number, maxMs: number): number {
  const min = Math.max(0, minMs);
  const max = Math.max(min, maxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 给 fetch / sendMessage / 开页采集套硬超时，避免挂死把整条轮询堵住 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const budget = Math.max(1, Math.floor(Number(ms) || 0));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), budget);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 轮询锁超过预算仍 busy：应强行解锁并关掉残留采集页，否则只能人手关标签才能继续 */
export function shouldForceUnlockPoll(input: {
  busy: boolean;
  startedAt: number;
  now: number;
  stuckMs: number;
}): boolean {
  if (!input.busy || input.startedAt <= 0) {
    return false;
  }
  return input.now - input.startedAt >= input.stuckMs;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomSleep(minMs: number, maxMs: number): Promise<number> {
  const ms = randomDelayMs(minMs, maxMs);
  await sleep(ms);
  return ms;
}
