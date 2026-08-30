/** 必须走 package exports 的 `./items`；`./dist/items` 在 Node/Jest 下会被 exports 拦住。 */
import { Configuration, DefaultApi, RuntimeResponseError } from 'wildberries-sdk/items';

export type WbSdkApis = {
  content: DefaultApi;
  prices: DefaultApi;
  marketplace: DefaultApi;
};

export type WbSdkTransportOptions = {
  token: string;
  contentBase: string;
  pricesBase: string;
  marketplaceBase: string;
  fetchImpl: typeof fetch;
};

/** wildberries-sdk（OpenAPI 生成客户端）按 Content / Prices / Marketplace 分 host */
export function createWbSdkApis(options: WbSdkTransportOptions): WbSdkApis {
  const make = (basePath: string) =>
    new DefaultApi(
      new Configuration({
        basePath,
        apiKey: () => options.token,
        fetchApi: options.fetchImpl as Configuration['fetchApi'],
        headers: { Accept: 'application/json' },
      }),
    );
  return {
    content: make(options.contentBase),
    prices: make(options.pricesBase),
    marketplace: make(options.marketplaceBase),
  };
}

export function isWbSdkResponseError(error: unknown): error is RuntimeResponseError {
  return error instanceof RuntimeResponseError;
}

export async function readWbSdkErrorBody(error: unknown): Promise<{ status: number; retryable: boolean; message: string }> {
  if (isWbSdkResponseError(error)) {
    const text = await error.response.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { errorText: text };
      }
    }
    const message = String(parsed.errorText || parsed.message || parsed.error || error.message || `Wildberries HTTP ${error.response.status}`);
    return {
      status: error.response.status,
      retryable: error.response.status === 429 || error.response.status >= 500,
      message,
    };
  }
  return {
    status: 0,
    retryable: true,
    message: error instanceof Error ? error.message : String(error),
  };
}
