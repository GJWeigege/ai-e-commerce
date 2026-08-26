import { CaptchaDetectedError } from './types';

export type RetryOptions = {
  maxRetry: number;
  /** 第 n 次重试等待毫秒，n 从 0 开始 */
  backoffMs?: (attempt: number) => number;
};

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const maxRetry = Math.max(0, options.maxRetry);
  const backoff = options.backoffMs ?? ((attempt) => 500 * 2 ** attempt);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // 验证码需要人工，不能盲目重试把账号打崩
      if (error instanceof CaptchaDetectedError) {
        throw error;
      }
      if (attempt === maxRetry) {
        break;
      }
      const wait = backoff(attempt);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function retryBackoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}
