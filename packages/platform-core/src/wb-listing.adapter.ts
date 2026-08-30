import {
  buildSubjectQueries,
  buildWbUploadPayload,
  buildWbVendorCode,
  clipWbText,
  countMissingWbSizes,
  existingCardHasForbiddenSizes,
  isWbDraftRecreateError,
  mapWbCharacteristics,
  mapWbSizes,
  mergeWbCardSizes,
  pickWbSubject,
  planWbCardRepair,
  collectWbChrtIds,
  compactWbBrandDirectory,
  isGenericWbBrandName,
  resolveWbBrand,
  resolveWbSizedFlag,
  wbVendorCodeLookupKeys,
  WB_DESCRIPTION_MAX,
  WbCardRepairState,
} from './wb-listing.mapper';
import { WbHttpClient, WbHttpError, isWbVendorCodeConflict } from './wb-listing.client';
import { cargoTypesFromStockError, rankWbStockWarehouses, type WbSellerWarehouse } from './wb-stock-warehouses';
import {
  loadCatalogValue,
  resetSharedWbCatalogStore,
  sharedWbCatalogStore,
  type WbCatalogStore,
} from './wb-catalog.store';
import {
  IWbListingAdapter,
  WbCardCharacteristic,
  WbCardRef,
  WbCharacteristicMeta,
  WbListProductResult,
  WbListingHints,
  WbListingMode,
  WbProductDraft,
  WbSubject,
  WbSubjectSource,
} from './wb-listing.types';

type WbDirectoryBundle = {
  colors: Awaited<ReturnType<WbHttpClient['getDirectory']>>;
  genders: Awaited<ReturnType<WbHttpClient['getDirectory']>>;
  countries: Awaited<ReturnType<WbHttpClient['getDirectory']>>;
  seasons: Awaited<ReturnType<WbHttpClient['getDirectory']>>;
  vat: string[];
};

type WbSubjectMeta = {
  charcs: WbCharacteristicMeta[];
  tnved: string[];
};

type WbCardPushResult = {
  barcodes: string[];
  card?: WbCardRef | null;
  /** 建卡撞货号后改走更新，需要向上层提示 */
  switchedToUpdate?: boolean;
};

/** 只清进程内目录缓存；磁盘 `config/wb-catalog` 仍保留，重启后继续给所有租户复用 */
export function resetWbListingCaches(): void {
  resetSharedWbCatalogStore();
}

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
  /** 同 Token 在途请求上限 */
  maxConcurrent?: number;
  /** 同 Token 相邻请求最小间隔（ms） */
  minIntervalMs?: number;
  /**
   * WB 官方目录（颜色/品牌/尺码/类目检索）。无租户隔离，所有店铺共用。
   * 不传则用进程单例：内存 + 项目 `config/wb-catalog`。
   */
  catalogStore?: WbCatalogStore;
};

export class LiveWbListingAdapter implements IWbListingAdapter {
  readonly mode: WbListingMode = 'live';
  private readonly client: WbHttpClient;
  private readonly defaultSubjectId?: number;
  private readonly warehouseId?: number;
  private readonly defaultBrand?: string;
  private readonly locale: string;
  private readonly catalogStore: WbCatalogStore;

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
      maxConcurrent: options.maxConcurrent,
      minIntervalMs: options.minIntervalMs,
    });
    this.defaultSubjectId = options.defaultSubjectId;
    this.warehouseId = options.warehouseId;
    this.defaultBrand = options.defaultBrand?.trim() || undefined;
    this.locale = options.locale || 'ru';
    this.catalogStore = options.catalogStore ?? sharedWbCatalogStore();
  }

  async listProduct(draft: WbProductDraft, hints?: WbListingHints): Promise<WbListProductResult> {
    const vendorCode = buildWbVendorCode(draft.skuId);
    const warnings: string[] = [];
    const repairs: string[] = [];
    let existing = await this.resolveExistingCard(draft.skuId, hints?.knownNmId, hints?.skipTrashLookup);
    const resolved = await this.resolveSubject(draft, hints?.subject);
    let subject = resolved.subject;
    let subjectSource = resolved.source;
    if (existing?.subjectID && existing.subjectID !== subject.subjectID) {
      warnings.push(
        `WB 不允许修改已建卡片类目，继续更新现有类目「${existing.subjectName || existing.subjectID}」（目标类目「${subject.subjectName}」）`,
      );
      subject = {
        subjectID: existing.subjectID,
        subjectName: existing.subjectName || subject.subjectName,
      };
      subjectSource = 'existing';
    }
    const [meta, directories, brandDirectory] = await Promise.all([
      this.loadSubjectMeta(subject.subjectID),
      this.loadDirectories(),
      this.loadSubjectBrands(subject.subjectID, draft.brand),
    ]);
    let brand = resolveWbBrand({ preferred: this.defaultBrand, crawled: draft.brand, directory: brandDirectory });

    const state: WbCardRepairState = {
      sized: resolveWbSizedFlag({
        hintSized: hints?.sized,
        subject,
        charcs: meta.charcs,
        draft,
      }),
      droppedCharcIds: [],
      descriptionMax: WB_DESCRIPTION_MAX,
      genericBrand: false,
    };
    existing = await this.dropBrokenDraft(existing, vendorCode, state.sized);

    let lastErrors: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const mapped = mapWbCharacteristics(
        meta.charcs,
        draft,
        { ...directories, tnved: meta.tnved },
        { brand, skipCharcIds: state.droppedCharcIds },
      );
      if (mapped.missingRequired.length) {
        throw new Error(`缺少 Wildberries 必填特性: ${mapped.missingRequired.join('、')}`);
      }
      const pushed = existing
        ? await this.pushUpdate(existing, draft, vendorCode, subject, mapped.characteristics, brand, state)
        : await this.pushUpload(draft, vendorCode, subject, mapped.characteristics, brand, state);
      if (pushed.switchedToUpdate) {
        warnings.push('货号已存在，已改为更新原卡片');
      }
      existing = pushed.card ?? existing;

      const confirmed = await this.confirmCard(vendorCode, Boolean(existing?.nmId));
      if (!confirmed.errors.length) {
        const card = confirmed.card ?? existing;
        return {
          mode: 'live',
          vendorCode,
          subjectID: subject.subjectID,
          subjectName: subject.subjectName,
          subjectSource,
          nmId: card?.nmId,
          imtId: card?.imtId,
          barcodes: pushed.barcodes.length ? pushed.barcodes : card?.sizes?.flatMap((item) => item.skus) || [],
          chrtIds: collectWbChrtIds(card?.sizes),
          uploaded: true,
          sized: state.sized,
          repairs,
          warnings,
        };
      }
      lastErrors = confirmed.errors;
      if (
        state.genericBrand &&
        confirmed.card?.nmId &&
        lastErrors.every((item) => /бренд.*не найден/i.test(item))
      ) {
        return {
          mode: 'live',
          vendorCode,
          subjectID: subject.subjectID,
          subjectName: subject.subjectName,
          subjectSource,
          nmId: confirmed.card.nmId,
          imtId: confirmed.card.imtId,
          barcodes: pushed.barcodes.length ? pushed.barcodes : confirmed.card.sizes?.flatMap((item) => item.skus) || [],
          chrtIds: collectWbChrtIds(confirmed.card.sizes),
          uploaded: true,
          sized: state.sized,
          repairs,
          warnings: [...warnings, 'WB 错误列表仍残留旧品牌拒卡，新卡已生成，已忽略'],
        };
      }
      const plan = planWbCardRepair(confirmed.errors, { charcs: meta.charcs, state });
      if (!plan) {
        break;
      }
      if (plan.sized != null) {
        state.sized = plan.sized;
      }
      if (plan.dropCharcIds?.length) {
        state.droppedCharcIds = [...new Set([...state.droppedCharcIds, ...plan.dropCharcIds])];
      }
      if (plan.descriptionMax) {
        state.descriptionMax = plan.descriptionMax;
      }
      if (plan.useGenericBrand) {
        state.genericBrand = true;
        brand = resolveWbBrand({ directory: brandDirectory });
      }
      repairs.push(plan.reason);
      if (plan.recreate) {
        existing = await this.trashDraftCard(existing, vendorCode);
      }
    }
    throw new Error(lastErrors.join('；') || 'Wildberries 拒绝了本次建卡，未返回具体原因');
  }

  async suggestSubjects(input: { categoryPath?: string | null; name?: string; keyword?: string }): Promise<WbSubject[]> {
    const queries = input.keyword?.trim()
      ? [input.keyword.trim()]
      : buildSubjectQueries(input.categoryPath, input.name).slice(0, 6);
    const found = new Map<number, WbSubject>();
    for (const query of queries) {
      for (const subject of await this.searchSubjectsCached(query, this.locale)) {
        if (!found.has(subject.subjectID)) {
          found.set(subject.subjectID, subject);
        }
      }
      if (found.size >= 50) {
        break;
      }
    }
    const ordered = [...found.values()];
    const best = pickWbSubject(ordered, queries);
    if (!best) {
      return ordered;
    }
    return [best, ...ordered.filter((item) => item.subjectID !== best.subjectID)];
  }

  /** 新建卡片；货号冲突时自动改走更新，避免重复建卡被 WB 判风控 */
  private async pushUpload(
    draft: WbProductDraft,
    vendorCode: string,
    subject: WbSubject,
    characteristics: WbCardCharacteristic[],
    brand: string,
    state: WbCardRepairState,
  ): Promise<WbCardPushResult> {
    const sizeCount = Math.max(1, mapWbSizes(draft, ['placeholder'], { sized: state.sized }).length);
    const barcodes = await this.client.generateBarcodes(sizeCount);
    if (barcodes.length < sizeCount) {
      throw new Error('Wildberries 条码生成数量不足');
    }
    const payload = buildWbUploadPayload({
      subject,
      draft,
      vendorCode,
      barcodes,
      characteristics,
      brand,
      sized: state.sized,
      descriptionMax: state.descriptionMax,
    });
    try {
      await this.client.uploadCards(payload);
      return { barcodes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isWbVendorCodeConflict(message)) {
        throw error;
      }
      const card = await this.resolveExistingCard(draft.skuId);
      if (!card) {
        throw error;
      }
      const merged = await this.pushUpdate(card, draft, vendorCode, subject, characteristics, brand, state);
      return {
        barcodes: merged.barcodes.length ? merged.barcodes : barcodes,
        card,
        switchedToUpdate: true,
      };
    }
  }

  private async pushUpdate(
    existing: WbCardRef,
    draft: WbProductDraft,
    vendorCode: string,
    subject: WbSubject,
    characteristics: WbCardCharacteristic[],
    brand: string,
    state: WbCardRepairState,
  ): Promise<WbCardPushResult> {
    const barcodes = await this.updateExistingCard(existing, draft, vendorCode, subject, characteristics, brand, state);
    return { barcodes, card: existing };
  }

  /**
   * 建卡是异步的：upload 返回 200 只代表进了队列。
   * 这里轮询错误列表与卡片列表，把「拒卡原因」尽早拿到手，交给自愈流程当场修。
   */
  private async confirmCard(vendorCode: string, knownCard: boolean): Promise<{ card: WbCardRef | null; errors: string[] }> {
    // 先立刻查一次错误，再短轮询 nmID。长等待交给上层，避免每个商品空等 6~15 秒
    const delays = knownCard ? [0, 400, 900] : [0, 500, 1200];
    for (let index = 0; index < delays.length; index += 1) {
      if (delays[index]) {
        await this.sleep(delays[index]);
      }
      const checkErrors = index < 2;
      const [errors, cards] = await Promise.all([
        checkErrors ? this.listErrors(vendorCode).catch(() => [] as string[]) : Promise.resolve([] as string[]),
        this.client.findCards(vendorCode).catch(() => [] as WbCardRef[]),
      ]);
      if (errors.length) {
        return { card: cards[0] || null, errors };
      }
      if (cards[0]?.nmId) {
        return { card: cards[0], errors: [] };
      }
    }
    return { card: null, errors: [] };
  }

  /** WB 要求先删「Черновик」里的坏卡才能用同一货号重建 */
  private async trashDraftCard(existing: WbCardRef | null, vendorCode: string): Promise<null> {
    const card = existing || (await this.client.findCards(vendorCode).catch(() => [] as WbCardRef[]))[0] || null;
    if (!card?.nmId) {
      return null;
    }
    await this.client.trashCards([card.nmId]).catch(() => undefined);
    await this.sleep(300);
    return null;
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
    const images = await Promise.all(valid.map((url) => this.fetchImageWithFallback(url).then((image) => ({ url, image }))));
    for (const item of images) {
      if (!item.image) {
        failures.push(`${item.url} 下载失败`);
        continue;
      }
      try {
        // 图片必须按序号顺序传；间隔交给 Token 限流闸门控制，不再额外硬等
        await this.client.uploadMediaFile(nmId, uploaded + 1, item.image.bytes, item.image.contentType);
        uploaded += 1;
      } catch (error) {
        failures.push(`${item.url}: ${error instanceof Error ? error.message : String(error)}`);
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

  async setStocks(chrtIds: number[], amount: number, warehouseId?: number, cargoType?: number): Promise<number> {
    const ids = collectWbChrtIds(chrtIds.map((chrtId) => ({ chrtId })));
    if (!ids.length) {
      throw new Error('卡片尚未生成尺码 ID（chrtId），无法同步库存');
    }
    const stocks = ids.map((chrtId) => ({ chrtId, amount: Math.max(0, Math.round(amount)) }));
    const preferred = warehouseId || this.warehouseId;
    const warehouses = (await this.client.listWarehouses().catch(() => [] as WbSellerWarehouse[])).map((item) => ({
      id: item.id,
      name: item.name,
      cargoType: item.cargoType,
      deliveryType: item.deliveryType,
    }));
    let needed: number | number[] | undefined = cargoType;
    let candidates = rankWbStockWarehouses(warehouses, { preferredId: preferred, cargoType: needed });
    if (!candidates.length) {
      if (!preferred) {
        throw new Error('未找到可同步库存的卖家仓库。Token 需含 Marketplace 权限，并在店铺 extra.warehouseId 指定仓库');
      }
      candidates = [{ id: preferred, name: '' }];
    }

    let lastError: Error | null = null;
    const tried = new Set<number>();
    for (let index = 0; index < candidates.length; index += 1) {
      const warehouse = candidates[index];
      if (tried.has(warehouse.id)) {
        continue;
      }
      tried.add(warehouse.id);
      try {
        await this.putStocksWithRetry(warehouse.id, stocks);
        return warehouse.id;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const required = cargoTypesFromStockError(lastError.message);
        if (!required) {
          continue;
        }
        needed = required;
        const rest = rankWbStockWarehouses(
          warehouses.filter((item) => !tried.has(item.id)),
          { cargoType: required },
        );
        candidates = candidates.slice(0, index + 1).concat(rest);
      }
    }
    throw lastError || new Error('库存同步失败');
  }

  private async putStocksWithRetry(warehouseId: number, stocks: Array<{ chrtId: number; amount: number }>): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.client.setStocks(warehouseId, stocks);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (cargoTypesFromStockError(lastError.message)) {
          throw lastError;
        }
        if (!/429|503|500|not found|не найден|еще не|not ready|timeout|fetch failed/i.test(lastError.message) && attempt > 0) {
          break;
        }
        await this.sleep(800 * (attempt + 1));
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
    state: WbCardRepairState,
  ): Promise<string[]> {
    const sized = state.sized;
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
      descriptionMax: state.descriptionMax,
    });
    const variant = payload[0].variants[0];
    const description = clipWbText(variant.description, state.descriptionMax);
    await this.client.updateCards([
      {
        nmID: existing.nmId,
        vendorCode,
        title: variant.title,
        description,
        brand,
        ...(variant.dimensions ? { dimensions: variant.dimensions } : {}),
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
      await this.sleep(300);
    } catch (error) {
      throw new Error(
        `WB 草稿卡含尺码或品牌错误，请先在卖家后台「Черновик」删除后重试: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }

  /**
   * 特性 + ТН ВЭД。第一次打 WB，之后任意租户/店铺复用。
   * 品牌表单独按需加载：店铺已配品牌时根本不会去拉上万条目录。
   */
  private loadSubjectMeta(subjectID: number): Promise<WbSubjectMeta> {
    return loadCatalogValue(this.catalogStore, 'subject-meta', `${subjectID}|${this.locale}`, async () => {
      const [charcs, tnved] = await Promise.all([
        this.client.getCharacteristics(subjectID, this.locale),
        this.client.getTnved(subjectID, this.locale).catch(() => [] as string[]),
      ]);
      return { charcs, tnved };
    });
  }

  /**
   * 只有「没有店铺品牌、且采集品牌需要对照目录」时才拉。
   * 结果按类目共享；单类目截断，避免服装类目把堆和磁盘撑满。
   */
  private loadSubjectBrands(subjectID: number, crawled?: string | null): Promise<string[]> {
    if (this.defaultBrand) {
      return Promise.resolve([]);
    }
    const name = String(crawled || '').trim();
    if (!name || isGenericWbBrandName(name)) {
      return Promise.resolve([]);
    }
    return loadCatalogValue(this.catalogStore, 'subject-brands', String(subjectID), async () => {
      const brands = await this.client.getSubjectBrands(subjectID).catch(() => [] as string[]);
      return compactWbBrandDirectory(brands, [name]);
    });
  }

  private searchSubjectsCached(query: string, locale: string): Promise<WbSubject[]> {
    return loadCatalogValue(this.catalogStore, 'subject-search', `${locale}|${query.toLowerCase()}`, () =>
      this.client.searchSubjects(query, locale).catch(() => [] as WbSubject[]),
    );
  }

  private listParentSubjectsCached(locale: string) {
    return loadCatalogValue(this.catalogStore, 'parent-subjects', locale, () => this.client.listParentSubjects(locale));
  }

  private listSubjectsByParentCached(parentID: number, locale: string) {
    return loadCatalogValue(this.catalogStore, 'subjects-by-parent', `${parentID}|${locale}`, () =>
      this.client.listSubjectsByParent(parentID, locale),
    );
  }

  /**
   * 反查已建卡片。库里记过 nmID 时只查主货号一次即可命中，
   * 省掉历史货号试探与回收站恢复这 3~4 次 POST。
   */
  private async resolveExistingCard(
    skuId: string,
    knownNmId?: number | null,
    skipTrashLookup = false,
  ): Promise<WbCardRef | null> {
    const primary = buildWbVendorCode(skuId);
    if (knownNmId) {
      const active = await this.client.findCards(primary).catch(() => [] as WbCardRef[]);
      const matched = active.find((item) => item.nmId === knownNmId) || active[0];
      if (matched) {
        return matched;
      }
    }
    const lookupKeys = knownNmId
      ? wbVendorCodeLookupKeys(skuId).filter((item) => item !== primary)
      : wbVendorCodeLookupKeys(skuId);
    if (lookupKeys.length) {
      const found = await Promise.all(
        lookupKeys.map((vendorCode) => this.client.findCards(vendorCode).catch(() => [] as WbCardRef[])),
      );
      const hit = found.find((cards) => cards[0])?.[0];
      if (hit) {
        return hit;
      }
    }
    if (skipTrashLookup) {
      return null;
    }
    for (const vendorCode of wbVendorCodeLookupKeys(skuId)) {
      const trashed = await this.client.findTrashCards(vendorCode);
      if (!trashed[0]) {
        continue;
      }
      await this.client.recoverCards([trashed[0].nmId]);
      await this.sleep(300);
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

  private async resolveSubject(
    draft: WbProductDraft,
    hint?: { subjectID: number; subjectName: string },
  ): Promise<{ subject: WbSubject; source: WbSubjectSource }> {
    // 命中类目映射表就整段跳过 WB 检索：这是批量上架最大的一块耗时
    if (hint?.subjectID) {
      return { subject: { subjectID: hint.subjectID, subjectName: hint.subjectName }, source: 'hint' };
    }
    const queries = buildSubjectQueries(draft.categoryPath, draft.name).slice(0, 8);
    const locales = [...new Set([this.locale, 'ru'])];
    let fallback: WbSubject | null = null;
    for (const locale of locales) {
      // 前 4 条查询并行：同一批商品类目接近，缓存命中后几乎零开销
      const batches = [queries.slice(0, 4), queries.slice(4)];
      for (const batch of batches) {
        if (!batch.length) {
          continue;
        }
        const results = await Promise.all(batch.map((query) => this.searchSubjectsCached(query, locale)));
        for (let index = 0; index < results.length; index += 1) {
          const subjects = results[index];
          if (!subjects.length) {
            continue;
          }
          if (!fallback) {
            fallback = subjects[0];
          }
          const matched = pickWbSubject(subjects, queries) || pickWbSubject(subjects, [batch[index]]);
          if (matched) {
            return { subject: matched, source: 'search' };
          }
        }
      }
    }
    for (const locale of locales) {
      const parents = await this.listParentSubjectsCached(locale);
      const parent = pickWbSubject(
        parents.map((item) => ({
          subjectID: item.parentID,
          subjectName: item.parentName,
          parentID: item.parentID,
          parentName: item.parentName,
        })),
        queries,
      );
      if (!parent?.parentID && !parent?.subjectID) {
        continue;
      }
      const parentID = parent.parentID || parent.subjectID;
      const children = await this.listSubjectsByParentCached(parentID, locale);
      if (!children.length) {
        continue;
      }
      const matched = pickWbSubject(children, queries);
      if (matched) {
        return { subject: matched, source: 'search' };
      }
      if (!fallback) {
        fallback = children[0];
      }
    }
    if (fallback) {
      return { subject: fallback, source: 'search' };
    }
    if (this.defaultSubjectId) {
      return { subject: { subjectID: this.defaultSubjectId, subjectName: 'default' }, source: 'default' };
    }
    throw new Error(
      `无法匹配 Wildberries 类目。已尝试: ${queries.join(' / ') || draft.name}。可在「类目映射」页为该 Ozon 类目手工指定 WB 类目`,
    );
  }

  private loadDirectories(): Promise<WbDirectoryBundle> {
    return loadCatalogValue(this.catalogStore, 'directories', this.locale, async () => {
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
      const [vatItems, colors, genders, countries, seasons] = await Promise.all([
        load('/content/v2/directory/vat'),
        load('/content/v2/directory/colors'),
        load('/content/v2/directory/kinds'),
        load('/content/v2/directory/countries'),
        load('/content/v2/directory/seasons'),
      ]);
      return {
        colors,
        genders,
        countries,
        seasons,
        vat: vatItems.map((item) => item.name),
      };
    });
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
