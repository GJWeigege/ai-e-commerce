export function randomDelayMs(minMs: number, maxMs: number): number {
  const min = Math.max(0, minMs);
  const max = Math.max(min, maxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomSleep(minMs: number, maxMs: number): Promise<number> {
  const ms = randomDelayMs(minMs, maxMs);
  await sleep(ms);
  return ms;
}
