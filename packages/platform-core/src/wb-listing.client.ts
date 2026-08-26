import { WbCardRef, WbCardUpdateItem, WbCardUploadItem, WbCharacteristicMeta, WbDirectoryItem, WbSubject } from './wb-listing.types';

export class WbHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WbHttpError';
  }
}

export function isWbVendorCodeConflict(message: string): boolean {
  return /vendor code is used|артикул.*уже|vendorCode.*used/i.test(message);
}

const tokenGates = new Map<string, Promise<void>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WbHttpClientOptions = {
  token: string;
  contentBase?: string;
  pricesBase?: string;
  marketplaceBase?: string;
  fetchImpl?: typeof fetch;
};

export class WbHttpClient {
  private readonly token: string;
  private readonly contentBase: string;
  private readonly pricesBase: string;
  private readonly marketplaceBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WbHttpClientOptions) {
    this.token = options.token;
    this.contentBase = (options.contentBase || 'https://content-api.wildberries.ru').replace(/\/$/, '');
    this.pricesBase = (options.pricesBase || 'https://discounts-prices-api.wildberries.ru').replace(/\/$/, '');
    this.marketplaceBase = (options.marketplaceBase || 'https://marketplace-api.wildberries.ru').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async searchSubjects(name: string, locale = 'ru'): Promise<WbSubject[]> {
    const json = await this.request<{ data?: Array<Record<string, unknown>> }>(
      'GET',
      `${this.contentBase}/content/v2/object/all?${new URLSearchParams({ name, locale, limit: '50' }).toString()}`,
    );
    return (json.data || [])
      .map((item) => ({
        subjectID: Number(item.subjectID ?? item.subjectId ?? item.id),
        subjectName: String(item.subjectName ?? item.name ?? ''),
        parentID: item.parentID == null ? undefined : Number(item.parentID),
        parentName: item.parentName == null ? undefined : String(item.parentName),
        isSize: parseOptionalBool(item.isSize ?? item.is_size ?? item.hasSize),
      }))
      .filter((item) => item.subjectID && item.subjectName);
  }

  async getCharacteristics(subjectID: number, locale = 'ru'): Promise<WbCharacteristicMeta[]> {
    const json = await this.request<{ data?: Array<Record<string, unknown>> }>(
      'GET',
      `${this.contentBase}/content/v2/object/charcs/${subjectID}?${new URLSearchParams({ locale }).toString()}`,
    );
    return (json.data || []).map((item) => ({
      charcID: Number(item.charcID ?? item.id),
      name: String(item.name ?? item.charcName ?? ''),
      required: Boolean(item.required),
      unitName: item.unitName == null ? undefined : String(item.unitName),
      maxCount: item.maxCount == null ? undefined : Number(item.maxCount),
      charcType: item.charcType == null ? undefined : Number(item.charcType),
    }));
  }

  async getDirectory(path: string, locale = 'ru'): Promise<WbDirectoryItem[]> {
    const json = await this.request<{ data?: Array<Record<string, unknown>> | string[] }>(
      'GET',
      `${this.contentBase}${path}?${new URLSearchParams({ locale }).toString()}`,
    );
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows
      .map((item) => {
        if (typeof item === 'string') {
          return { name: item };
        }
        return {
          name: String(item.name ?? item.value ?? ''),
          hex: item.hex == null ? undefined : String(item.hex),
        };
      })
      .filter((item) => item.name);
  }

  /** 按类目拉取 WB 品牌目录，供店铺品牌 / 采集品牌对齐拼写；目录未命中仍提交原名，由 WB 判定 */
  async getSubjectBrands(subjectID: number, limitPages = 6): Promise<string[]> {
    const names: string[] = [];
    const collect = (rows: Array<Record<string, unknown> | string>) => {
      for (const item of rows) {
        const name = typeof item === 'string' ? item.trim() : String(item.name ?? item.value ?? '').trim();
        if (name) {
          names.push(name);
        }
      }
    };
    const endpoints = [
      `${this.contentBase}/content/v2/directory/brands?${new URLSearchParams({ subjectID: String(subjectID) }).toString()}`,
      `${this.contentBase}/content/v2/directory/brands?${new URLSearchParams({ subjectId: String(subjectID) }).toString()}`,
    ];
    for (const url of endpoints) {
      const json = await this.request<{
        brands?: Array<Record<string, unknown> | string>;
        data?: Array<Record<string, unknown> | string>;
      }>('GET', url).catch(
        (): { brands?: Array<Record<string, unknown> | string>; data?: Array<Record<string, unknown> | string> } => ({}),
      );
      collect(json.brands || json.data || []);
      if (names.length) {
        return [...new Set(names)];
      }
    }
    let next: number | undefined;
    for (let page = 0; page < limitPages; page += 1) {
      const query = new URLSearchParams({ subjectId: String(subjectID) });
      if (next != null) {
        query.set('next', String(next));
      }
      const json = await this.request<{
        brands?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
        next?: number;
      }>('GET', `${this.contentBase}/api/content/v1/brands?${query.toString()}`).catch(
        (): { brands?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>>; next?: number } => ({}),
      );
      const rows = json.brands || json.data || [];
      collect(rows);
      const following = json.next == null ? undefined : Number(json.next);
      if (!following || following === next || !rows.length) {
        break;
      }
      next = following;
    }
    return [...new Set(names)];
  }

  /** 有返回值说明该类目按尺码建卡；空或接口不存在则视为无尺码 */
  async getSubjectSizes(subjectID: number, locale = 'ru'): Promise<string[]> {
    const json = await this.request<{ data?: Array<Record<string, unknown>> | string[] }>(
      'GET',
      `${this.contentBase}/content/v2/directory/sizes?${new URLSearchParams({
        subjectID: String(subjectID),
        locale,
      }).toString()}`,
    ).catch((): { data?: Array<Record<string, unknown>> | string[] } => ({}));
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows
      .map((item) => (typeof item === 'string' ? item : String(item.name ?? item.techSize ?? item.value ?? '')))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async generateBarcodes(count: number): Promise<string[]> {
    const json = await this.request<{ data?: string[] }>('POST', `${this.contentBase}/content/v2/barcodes`, { count });
    return json.data || [];
  }

  async uploadCards(payload: WbCardUploadItem[]): Promise<void> {
    await this.request('POST', `${this.contentBase}/content/v2/cards/upload`, payload);
  }

  async findCards(vendorCode: string): Promise<WbCardRef[]> {
    const json = await this.request<{ cards?: Array<Record<string, unknown>> }>(
      'POST',
      `${this.contentBase}/content/v2/get/cards/list`,
      {
        settings: {
          sort: { ascending: false },
          filter: { textSearch: vendorCode, withPhoto: -1 },
          cursor: { limit: 100 },
        },
      },
    );
    return parseCardRefs(json.cards, vendorCode);
  }

  async findTrashCards(vendorCode: string): Promise<WbCardRef[]> {
    const json = await this.request<{ cards?: Array<Record<string, unknown>> }>(
      'POST',
      `${this.contentBase}/content/v2/get/cards/trash`,
      {
        settings: {
          sort: { ascending: false },
          filter: { textSearch: vendorCode, withPhoto: -1 },
          cursor: { limit: 100 },
        },
      },
    );
    return parseCardRefs(json.cards, vendorCode);
  }

  async recoverCards(nmIDs: number[]): Promise<void> {
    if (!nmIDs.length) {
      return;
    }
    await this.request('POST', `${this.contentBase}/content/v2/cards/recover`, { nmIDs });
  }

  async listCardErrors(): Promise<Array<{ vendorCode: string; errors: string[] }>> {
    const json = await this.request<{
      data?: { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    }>('POST', `${this.contentBase}/content/v2/cards/error/list`, {
      cursor: { limit: 100 },
      order: { ascending: true },
    });
    const items = Array.isArray(json.data) ? json.data : json.data?.items || [];
    const result: Array<{ vendorCode: string; errors: string[] }> = [];
    for (const item of items) {
      const vendorCodes = (item.vendorCodes as string[]) || (item.vendorCode ? [String(item.vendorCode)] : []);
      const errors =
        item.errors && typeof item.errors === 'object' && !Array.isArray(item.errors)
          ? (item.errors as Record<string, string[]>)
          : null;
      if (errors) {
        for (const [code, messages] of Object.entries(errors)) {
          result.push({ vendorCode: code, errors: messages });
        }
      } else {
        const messages = Array.isArray(item.errors)
          ? item.errors.map(String)
          : [String(item.errorText || item.error || '')].filter(Boolean);
        for (const code of vendorCodes) {
          result.push({ vendorCode: code, errors: messages });
        }
      }
    }
    return result;
  }

  async getTnved(subjectID: number, locale = 'ru'): Promise<string[]> {
    const json = await this.request<{ data?: Array<Record<string, unknown>> }>(
      'GET',
      `${this.contentBase}/content/v2/directory/tnved?${new URLSearchParams({ subjectID: String(subjectID), locale }).toString()}`,
    );
    return (json.data || [])
      .map((item) => String(item.tnved ?? item.name ?? ''))
      .filter(Boolean);
  }

  async updateCards(payload: WbCardUpdateItem[]): Promise<void> {
    await this.request('POST', `${this.contentBase}/content/v2/cards/update`, payload);
  }

  async saveMedia(nmId: number, urls: string[]): Promise<void> {
    await this.request('POST', `${this.contentBase}/content/v3/media/save`, { nmId, data: urls });
  }

  async uploadMediaFile(nmId: number, photoNumber: number, file: Uint8Array, contentType: string): Promise<void> {
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const payload = new Uint8Array(file.byteLength);
    payload.set(file);
    await this.runWithTokenGate(async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const form = new FormData();
        form.append('uploadfile', new Blob([payload.buffer], { type: contentType || 'image/jpeg' }), `photo-${photoNumber}.${extension}`);
        const response = await this.fetchImpl(`${this.contentBase}/content/v3/media/file`, {
          method: 'POST',
          headers: {
            Authorization: this.token,
            'X-Nm-Id': String(nmId),
            'X-Photo-Number': String(photoNumber),
          },
          body: form,
        });
        const text = await response.text();
        let json: Record<string, unknown> = {};
        if (text) {
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = { errorText: text };
          }
        }
        if (response.status === 429) {
          await sleep(readRetryAfter(response) || 15000 * (attempt + 1));
          continue;
        }
        if (!response.ok || json.error === true) {
          throw new WbHttpError(
            formatWbError(json, response.status),
            response.status,
            response.status >= 500,
          );
        }
        return;
      }
      throw new WbHttpError('Wildberries HTTP 429', 429, true);
    });
  }

  async setPrice(nmId: number, price: number, discount = 0): Promise<void> {
    await this.request('POST', `${this.pricesBase}/api/v2/upload/task`, {
      data: [{ nmID: nmId, price, discount }],
    });
  }

  async listWarehouses(): Promise<Array<{ id: number; name: string; cargoType?: number; deliveryType?: number }>> {
    const json = await this.request<Array<Record<string, unknown>> | { data?: Array<Record<string, unknown>> }>(
      'GET',
      `${this.marketplaceBase}/api/v3/warehouses`,
    );
    const rows = Array.isArray(json) ? json : json.data || [];
    return rows
      .map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? ''),
        cargoType: item.cargoType == null ? undefined : Number(item.cargoType),
        deliveryType: item.deliveryType == null ? undefined : Number(item.deliveryType),
      }))
      .filter((item) => item.id);
  }

  async setStocks(warehouseId: number, stocks: Array<{ sku: string; amount: number }>): Promise<void> {
    await this.request('PUT', `${this.marketplaceBase}/api/v3/stocks/${warehouseId}`, { stocks });
  }

  async trashCards(nmIDs: number[]): Promise<void> {
    await this.request('POST', `${this.contentBase}/content/v2/cards/delete/trash`, { nmIDs });
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return this.runWithTokenGate(async () => {
      await sleep(650);
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const response = await this.fetchImpl(url, {
            method,
            headers: {
              Authorization: this.token,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: body == null ? undefined : JSON.stringify(body),
          });
          const text = await response.text();
          let parsed: unknown = {};
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { errorText: text };
            }
          }
          if (response.status === 429) {
            await sleep(readRetryAfter(response) || Math.min(60000, 12000 * (attempt + 1)));
            continue;
          }
          if (Array.isArray(parsed)) {
            if (!response.ok) {
              throw new WbHttpError(`Wildberries HTTP ${response.status}`, response.status, response.status >= 500);
            }
            return parsed as T;
          }
          const json = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
          if (!response.ok || json.error === true) {
            throw new WbHttpError(
              formatWbError(json, response.status),
              response.status,
              response.status >= 500,
            );
          }
          return json as T;
        } catch (error) {
          if (error instanceof WbHttpError) {
            if (!error.retryable) {
              throw error;
            }
            lastError = error;
            await sleep(Math.min(60000, 8000 * (attempt + 1)));
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          lastError = new WbHttpError(
            `Wildberries 网络请求失败 (${method} ${url.replace(/\?.*$/, '')}): ${message}`,
            0,
            true,
          );
          await sleep(Math.min(30000, 5000 * (attempt + 1)));
        }
      }
      throw lastError || new WbHttpError('Wildberries HTTP 429', 429, true);
    });
  }

  private async runWithTokenGate<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tokenGates.get(this.token) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tokenGates.set(this.token, prev.then(() => current));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }
  return undefined;
}

function parseCardRefs(rows: Array<Record<string, unknown>> | undefined, vendorCode: string): WbCardRef[] {
  return (rows || [])
    .map((item) => ({
      nmId: Number(item.nmID ?? item.nmId),
      imtId: item.imtID == null && item.imtId == null ? undefined : Number(item.imtID ?? item.imtId),
      vendorCode: String(item.vendorCode ?? ''),
      subjectID: item.subjectID == null ? undefined : Number(item.subjectID),
      subjectName: item.subjectName == null ? undefined : String(item.subjectName),
      title: item.title == null ? undefined : String(item.title),
      sizes: Array.isArray(item.sizes)
        ? (item.sizes as Array<Record<string, unknown>>).map((size) => ({
            chrtID: size.chrtID == null ? undefined : Number(size.chrtID),
            techSize: String(size.techSize ?? '0'),
            wbSize: size.wbSize == null ? undefined : String(size.wbSize),
            skus: Array.isArray(size.skus) ? size.skus.map(String) : [],
          }))
        : undefined,
    }))
    .filter((item) => item.nmId && item.vendorCode.toUpperCase() === vendorCode.toUpperCase());
}

function formatWbError(json: Record<string, unknown>, status: number): string {
  const extra = json.additionalErrors;
  const extraText =
    extra && typeof extra === 'object'
      ? Object.values(extra as Record<string, unknown>)
          .flat()
          .map(String)
          .join('；')
      : extra
        ? String(extra)
        : '';
  return [json.errorText || json.message || json.error, extraText].filter(Boolean).join('；') || `Wildberries HTTP ${status}`;
}

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(120000, seconds * 1000) : null;
}
