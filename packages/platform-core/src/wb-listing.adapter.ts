import {
  buildSubjectQueries,
  buildWbUploadPayload,
  buildWbVendorCode,
  clipWbText,
  countMissingWbSizes,
  existingCardHasForbiddenSizes,
  isWbDraftRecreateError,
  isWbSizedCategory,
  mapWbCharacteristics,
  mapWbSizes,
  mergeWbCardSizes,
  pickWbSubject,
  resolveWbBrand,
  wbVendorCodeLookupKeys,
} from './wb-listing.mapper';
import { WbHttpClient, WbHttpError, isWbVendorCodeConflict } from './wb-listing.client';
import {
  IWbListingAdapter,
  WbCardCharacteristic,
  WbCardRef,
  WbListProductResult,
  WbListingMode,
  WbProductDraft,
  WbSubject,
} from './wb-listing.types';

export type WbListingAdapterOptions = {
  token?: string;
  contentBase?: string;
  pricesBase?: string;
  marketplaceBase?: string;
  defaultSubjectId?: number;
  warehouseId?: number;
  /** 店铺 extra.brand；有则优先提交，是否通过由 WB 判定 */
  defaultBrand?: string;
  locale?: string;
  fetchImpl?: typeof fetch;
};

export class LiveWbListingAdapter implements IWbListingAdapter {
  readonly mode: WbListingMode = 'live';
  private readonly client: WbHttpClient;
  private readonly defaultSubjectId?: number;
  private readonly warehouseId?: number;
  private readonly defaultBrand?: string;
  private readonly locale: string;

  constructor(options: WbListingAdapterOptions) {
    if (!options.token) {
      throw new Error('缺少 Wildberries API Token，请在店铺管理中保存内容类 Token');
    }
    this.client = new WbHttpClient({
      token: options.token,
      contentBase: options.contentBase,
      pricesBase: options.pricesBase,
      marketplaceBase: options.marketplaceBase,
      fetchImpl: options.fetchImpl,
    });
    this.defaultSubjectId = options.defaultSubjectId;
    this.warehouseId = options.warehouseId;
    this.defaultBrand = options.defaultBrand?.trim() || undefined;
    this.locale = options.locale || 'ru';
  }

  async listProduct(draft: WbProductDraft): Promise<WbListProductResult> {
    const vendorCode = buildWbVendorCode(draft.skuId);
    const warnings: string[] = [];
    let existing = await this.resolveExistingCard(draft.skuId);
    const preferred = await this.resolveSubject(draft);
    let subject = preferred;
    if (existing?.subjectID && existing.subjectID !== preferred.subjectID) {
      subject = {
        subjectID: existing.subjectID,
        subjectName: existing.subjectName || preferred.subjectName,
      };
      warnings.push(
        `WB 不允许修改已建卡片类目，继续更新现有类目「${subject.subjectName}」（目标类目「${preferred.subjectName}」）`,
      );
    }
    const charcs = await this.client.getCharacteristics(subject.subjectID, this.locale);
    const sizeDirectory = await this.client.getSubjectSizes(subject.subjectID, this.locale).catch(() => []);
    const sized = isWbSizedCategory({ subject, charcs, sizeDirectory, draft });
    existing = await this.dropBrokenDraft(existing, vendorCode, sized);
    const brand = await this.resolveBrand(subject.subjectID, draft.brand);
    const directories = await this.loadDirectories();
    const tnved = await this.client.getTnved(subject.subjectID, this.locale).catch(() => []);
    const mapped = mapWbCharacteristics(charcs, draft, { ...directories, tnved }, { brand });
    if (mapped.missingRequired.length) {
      throw new Error(`缺少 Wildberries 必填特性: ${mapped.missingRequired.join('、')}`);
    }

    if (existing) {
      if (existing.vendorCode && existing.vendorCode.toUpperCase() !== vendorCode.toUpperCase()) {
        warnings.push(`已将历史货号 ${existing.vendorCode} 更新为 ${vendorCode}（去掉 OZ 前缀）`);
      }
      const barcodes = await this.updateExistingCard(
        existing,
        draft,
        vendorCode,
        subject,
        mapped.characteristics,
        brand,
        sized,
      );
      return {
        mode: 'live',
        vendorCode,
        subjectID: subject.subjectID,
        subjectName: subject.subjectName,
        nmId: existing.nmId,
        imtId: existing.imtId,
        barcodes,
        uploaded: true,
        warnings,
      };
    }

    const sizeCount = Math.max(1, mapWbSizes(draft, ['placeholder'], { sized }).length);
    const barcodes = await this.client.generateBarcodes(sizeCount);
    if (barcodes.length < sizeCount) {
      throw new Error('Wildberries 条码生成数量不足');
    }
    const payload = buildWbUploadPayload({
      subject,
      draft,
      vendorCode,
      barcodes,
      characteristics: mapped.characteristics,
      brand,
      sized,
    });
    payload[0].variants[0].description = clipWbText(payload[0].variants[0].description, 1900);
    try {
      await this.client.uploadCards(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isWbVendorCodeConflict(message)) {
        throw error;
      }
      existing = await this.resolveExistingCard(draft.skuId);
      if (!existing) {
        throw error;
      }
      const mergedBarcodes = await this.updateExistingCard(
        existing,
        draft,
        vendorCode,
        subject,
        mapped.characteristics,
        brand,
        sized,
      );
      return {
        mode: 'live',
        vendorCode,
        subjectID: existing.subjectID || subject.subjectID,
        subjectName: existing.subjectName || subject.subjectName,
        nmId: existing.nmId,
        imtId: existing.imtId,
        barcodes: mergedBarcodes.length ? mergedBarcodes : barcodes,
        uploaded: true,
        warnings: [...warnings, '货号已存在，已改为更新原卡片'],
      };
    }
    return {
      mode: 'live',
      vendorCode,
      subjectID: subject.subjectID,
      subjectName: subject.subjectName,
      barcodes,
      uploaded: true,
      warnings,
    };
  }

  async findCard(vendorCode: string): Promise<WbCardRef | null> {
    for (const key of wbVendorCodeLookupKeys(vendorCode)) {
      const cards = await this.client.findCards(key);
      if (cards[0]) {
        return cards[0];
      }
    }
    return null;
  }

  async listErrors(vendorCode?: string): Promise<string[]> {
    const items = await this.client.listCardErrors();
    const keys = vendorCode ? new Set(wbVendorCodeLookupKeys(vendorCode).map((item) => item.toUpperCase())) : null;
    return items
      .filter((item) => !keys || keys.has(item.vendorCode.toUpperCase()))
      .flatMap((item) => item.errors);
  }

  async saveMedia(nmId: number, urls: string[]): Promise<void> {
    const valid = urls.filter((item) => /^https?:\/\//i.test(item)).slice(0, 10);
    if (!valid.length) {
      throw new Error('商品没有可上传的图片 URL');
    }
    let uploaded = 0;
    const failures: string[] = [];
    for (const url of valid) {
      const image = await this.fetchImageWithFallback(url);
      if (!image) {
        failures.push(`${url} 下载失败`);
        continue;
      }
      try {
        await this.client.uploadMediaFile(nmId, uploaded + 1, image.bytes, image.contentType);
        uploaded += 1;
        await this.sleep(700);
      } catch (error) {
        failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!uploaded) {
      try {
        await this.client.saveMedia(nmId, valid);
        return;
      } catch (error) {
        throw new Error(
          `图片上传失败（Ozon 图床通常禁止 WB 直接拉取，需服务端转存）: ${
            error instanceof Error ? error.message : String(error)
          }; ${failures.join('；')}`,
        );
      }
    }
  }

  async setPrice(nmId: number, price: number, discount = 0): Promise<void> {
    await this.client.setPrice(nmId, Math.max(1, Math.round(price)), discount);
  }

  async setStocks(barcodes: string[], amount: number, warehouseId?: number): Promise<number> {
    const skus = [...new Set(barcodes.map((item) => String(item || '').trim()).filter(Boolean))];
    if (!skus.length) {
      throw new Error('卡片尚未生成条码，无法同步库存');
    }
    const warehouse = warehouseId || this.warehouseId || (await this.resolveWarehouseId());
    if (!warehouse) {
      throw new Error('未找到可同步库存的卖家仓库。Token 需含 Marketplace 权限，并在店铺 extra.warehouseId 指定仓库');
    }
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.client.setStocks(
          warehouse,
          skus.map((sku) => ({ sku, amount: Math.max(0, Math.round(amount)) })),
        );
        return warehouse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // 新建卡后库存服务偶发未就绪 / 仓库短暂不可写
        if (!/429|503|500|not found|не найден|еще не|not ready|timeout|fetch failed/i.test(lastError.message) && attempt > 0) {
          break;
        }
        await this.sleep(3000 * (attempt + 1));
      }
    }
    throw lastError || new Error('库存同步失败');
  }

  async unlist(nmIds: number[]): Promise<void> {
    if (!nmIds.length) {
      return;
    }
    await this.client.trashCards(nmIds);
  }

  private async updateExistingCard(
    existing: WbCardRef,
    draft: WbProductDraft,
    vendorCode: string,
    subject: WbSubject,
    characteristics: WbCardCharacteristic[],
    brand: string,
    sized: boolean,
  ): Promise<string[]> {
    const existingSizes = existing.sizes || [];
    const wanted = mapWbSizes(draft, existingSizes.flatMap((item) => item.skus).filter(Boolean).concat('0'), {
      sized,
    });
    const missing = countMissingWbSizes(
      wanted.map((item) => item.techSize || '0'),
      existingSizes.map((item) => item.techSize),
    );
    const extraBarcodes = missing > 0 ? await this.client.generateBarcodes(missing) : [];
    if (extraBarcodes.length < missing) {
      throw new Error('Wildberries 条码生成数量不足，无法补齐多规格');
    }
    const merged = mergeWbCardSizes(wanted, existingSizes, extraBarcodes);
    const sizes = sized
      ? merged
      : merged.slice(0, 1).map((item) => ({
          chrtID: item.chrtID,
          skus: item.skus,
          price: item.price,
        }));
    const payload = buildWbUploadPayload({
      subject,
      draft,
      vendorCode,
      barcodes: sizes.flatMap((item) => item.skus),
      characteristics,
      brand,
      sized,
    });
    const variant = payload[0].variants[0];
    const description = clipWbText(variant.description, 1900);
    await this.client.updateCards([
      {
        nmID: existing.nmId,
        vendorCode,
        title: variant.title,
        description,
        brand,
        dimensions: variant.dimensions,
        characteristics: variant.characteristics,
        sizes,
      },
    ]);
    return sizes.flatMap((item) => item.skus).filter(Boolean);
  }

  private async dropBrokenDraft(
    existing: WbCardRef | null,
    vendorCode: string,
    sized: boolean,
  ): Promise<WbCardRef | null> {
    if (!existing) {
      return null;
    }
    const errors = await this.listErrors(vendorCode).catch(() => []);
    const recreate =
      errors.some((item) => isWbDraftRecreateError(item)) ||
      (!sized && existingCardHasForbiddenSizes(existing.sizes));
    if (!recreate) {
      return existing;
    }
    try {
      await this.client.trashCards([existing.nmId]);
      await this.sleep(3000);
    } catch (error) {
      throw new Error(
        `WB 草稿卡含尺码或品牌错误，请先在卖家后台「Черновик」删除后重试: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }

  private async resolveBrand(subjectID: number, crawledBrand?: string | null): Promise<string> {
    const directory = await this.client.getSubjectBrands(subjectID).catch(() => []);
    return resolveWbBrand({
      preferred: this.defaultBrand,
      crawled: crawledBrand,
      directory,
    });
  }

  private async resolveWarehouseId(): Promise<number | null> {
    const warehouses = await this.client.listWarehouses();
    if (!warehouses.length) {
      return null;
    }
    // deliveryType: 1 = FBS 自配送仓库；优先选名称含 склад / warehouse 的
    return (
      warehouses.find((item) => item.deliveryType === 1)?.id ||
      warehouses.find((item) => /склад|warehouse|fbs/i.test(item.name))?.id ||
      warehouses[0]?.id ||
      null
    );
  }

  private async resolveExistingCard(skuId: string): Promise<WbCardRef | null> {
    for (const vendorCode of wbVendorCodeLookupKeys(skuId)) {
      const active = await this.client.findCards(vendorCode);
      if (active[0]) {
        return active[0];
      }
    }
    for (const vendorCode of wbVendorCodeLookupKeys(skuId)) {
      const trashed = await this.client.findTrashCards(vendorCode);
      if (!trashed[0]) {
        continue;
      }
      await this.client.recoverCards([trashed[0].nmId]);
      await this.sleep(2000);
      const recovered = await this.client.findCards(vendorCode);
      return recovered[0] || trashed[0];
    }
    return null;
  }

  private async fetchImageWithFallback(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const candidates = [url.replace(/\/(c\d+|wc\d+|wcs\d+)\//i, '/'), url].filter(
      (item, index, list) => list.indexOf(item) === index,
    );
    for (const candidate of candidates) {
      const image = await this.fetchImage(candidate);
      if (image) {
        return image;
      }
    }
    return null;
  }

  private async fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://www.ozon.ru/',
          Accept: 'image/jpeg,image/png,image/webp;q=0.8,*/*;q=0.5',
        },
      });
      if (!response.ok) {
        return null;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 12_000) {
        return null;
      }
      const headerType = response.headers.get('content-type') || '';
      const contentType = headerType.startsWith('image/') ? headerType.split(';')[0] : sniffImageType(bytes);
      if (!contentType.startsWith('image/')) {
        return null;
      }
      return { bytes, contentType };
    } catch {
      return null;
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async resolveSubject(draft: WbProductDraft): Promise<WbSubject> {
    const queries = buildSubjectQueries(draft.categoryPath, draft.name).slice(0, 8);
    const locales = [...new Set([this.locale, 'ru'])];
    let fallback: WbSubject | null = null;
    for (const locale of locales) {
      for (const query of queries) {
        const subjects = await this.client.searchSubjects(query, locale);
        if (!subjects.length) {
          continue;
        }
        if (!fallback) {
          fallback = subjects[0];
        }
        const matched = pickWbSubject(subjects, queries) || pickWbSubject(subjects, [query]);
        if (matched) {
          return matched;
        }
      }
    }
    if (fallback) {
      return fallback;
    }
    if (this.defaultSubjectId) {
      return { subjectID: this.defaultSubjectId, subjectName: 'default' };
    }
    throw new Error(
      `无法匹配 Wildberries 类目。已尝试: ${queries.join(' / ') || draft.name}`,
    );
  }

  private async loadDirectories() {
    const load = async (path: string) => {
      try {
        return await this.client.getDirectory(path, this.locale);
      } catch (error) {
        if (error instanceof WbHttpError && error.retryable) {
          throw error;
        }
        return [];
      }
    };
    const vatItems = await load('/content/v2/directory/vat');
    return {
      colors: await load('/content/v2/directory/colors'),
      genders: await load('/content/v2/directory/kinds'),
      countries: await load('/content/v2/directory/countries'),
      seasons: await load('/content/v2/directory/seasons'),
      vat: vatItems.map((item) => item.name),
    };
  }
}

export function createWbListingAdapter(options: WbListingAdapterOptions): IWbListingAdapter {
  return new LiveWbListingAdapter(options);
}

function sniffImageType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  const ascii = String.fromCharCode(...bytes.slice(0, 12));
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return 'image/jpeg';
}
