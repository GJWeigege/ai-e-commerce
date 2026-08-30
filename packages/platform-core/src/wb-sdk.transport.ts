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
  if (error instanceof RuntimeResponseError) {
    return true;
  }
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { name?: string }).name === 'ResponseError' &&
      (error as { response?: unknown }).response instanceof Response,
  );
}

function asErrorText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** WB 库存等接口常返回错误数组；error 字段也可能是 boolean */
export function formatWbErrorPayload(parsed: unknown, status: number, fallback?: string): string {
  if (Array.isArray(parsed)) {
    const parts = parsed
      .map((item) => formatWbErrorPayload(item, status))
      .filter((item) => item && !/^Wildberries HTTP \d+$/.test(item));
    return parts.join('；') || fallback || `Wildberries HTTP ${status}`;
  }
  if (parsed && typeof parsed === 'object') {
    const json = parsed as Record<string, unknown>;
    const extra = json.additionalErrors;
    const extraText =
      extra && typeof extra === 'object'
        ? Object.values(extra as Record<string, unknown>)
            .flat()
            .map(String)
            .filter((item) => item && item !== 'true' && item !== 'false')
            .join('；')
        : extra
          ? String(extra)
          : '';
    const dataText = Array.isArray(json.data)
      ? json.data
          .map((item) => formatWbErrorPayload(item, status))
          .filter((item) => item && !/^Wildberries HTTP \d+$/.test(item))
          .join('；')
      : '';
    const main = [asErrorText(json.errorText), asErrorText(json.message), asErrorText(json.error), asErrorText(json.code)]
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index);
    return [...main, extraText, dataText].filter(Boolean).join('；') || fallback || `Wildberries HTTP ${status}`;
  }
  if (typeof parsed === 'string' && parsed.trim()) {
    return parsed.trim();
  }
  return fallback || `Wildberries HTTP ${status}`;
}

export async function readWbSdkErrorBody(error: unknown): Promise<{ status: number; retryable: boolean; message: string }> {
  if (isWbSdkResponseError(error)) {
    const text = await error.response.text().catch(() => '');
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { errorText: text };
      }
    }
    return {
      status: error.response.status,
      retryable: error.response.status === 429 || error.response.status >= 500,
      message: formatWbErrorPayload(parsed, error.response.status, `Wildberries HTTP ${error.response.status}`),
    };
  }
  return {
    status: 0,
    retryable: true,
    message: error instanceof Error ? error.message : String(error),
  };
}
