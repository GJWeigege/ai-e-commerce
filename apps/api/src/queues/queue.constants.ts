export const QUEUE_CRAWLER_PREPARE = 'crawler.prepare';
export const QUEUE_CRAWLER_RETRY = 'crawler.retry';
export const QUEUE_AI_SELECTION = 'ai.selection';
export const QUEUE_WB_LISTING = 'wb.listing';

export function redisConnectionFromUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}
