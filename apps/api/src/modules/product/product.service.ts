import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import { PlatformAccount, ProductStatus, Prisma, ReviewAction, WbListingStatus } from '@prisma/client';
import {
  familySkuIds,
  ProductSkuOption,
} from '@aiecom/shared';
import {
  OpenAiCompatibleProvider,
  SELECTION_PROMPT_VERSION,
  buildSelectionPrompt,
  parseSelectionOutput,
} from '@aiecom/llm-core';
import { collectImageUrls, createWbListingAdapter, isWbVendorCodeConflict, WbHttpError, WbProductDraft } from '@aiecom/platform-core';
import { computeShelfStock, computeWbShelfPrice, PriceSource, ShelfPriceMode } from './shelf-price';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { ShopAccessService } from '../../common/shop/shop-access.service';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { QUEUE_WB_LISTING } from '../../queues/queue.constants';
import { AuthUser } from '../auth/auth.types';
import { canUnlistShopListing, PRODUCT_CATALOG_STATUSES, PRODUCT_REVIEW_QUEUE_STATUSES } from './product-status';

export type ShelfOptions = {
  shopIds: string[];
  onShelf: boolean;
  /** 单品：折后价（可与 listPrice/discount 联用） */
  price?: number;
  stock?: number;
  priceMode?: ShelfPriceMode;
  priceMultiplier?: number;
  saleMultiplier?: number;
  listSource?: PriceSource;
  saleSource?: PriceSource;
  /** @deprecated 旧统一价 */
  fixedPrice?: number;
  listPrice?: number;
  salePrice?: number;
  discountPercent?: number;
  fixedListPrice?: number;
  fixedSalePrice?: number;
  fixedDiscountPercent?: number;
  /** 指定要一并上架的 Ozon SKU；空则上架该商品全部 skuOptions */
  skuIds?: string[];
};

export type WbListingJob = {
  tenantId: string;
  productId: string;
  shopId: string;
  /** 折后价，写入商品库 */
  price?: number;
  /** WB 划线原价 */
  listPrice?: number;
  /** WB 卖家折扣 % */
  discount?: number;
  stock?: number;
  skuIds?: string[];
  skuPrices?: Array<{ skuId: string; listPrice: number }>;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
    @Optional() @InjectQueue(QUEUE_WB_LISTING) private readonly listingQueue?: Queue,
  ) {}

  async page(
    tenantId: string | null,
    query: PageQueryDto & {
      status?: ProductStatus;
      keyword?: string;
      reviewOnly?: boolean;
      catalogOnly?: boolean;
      wbListingStatus?: WbListingStatus;
      categoryPath?: string;
      shopId?: string;
      recommended?: boolean;
    },
  ): Promise<PageResult<unknown>> {
    const tid = requireTenantId(tenantId);
    const keyword = query.keyword?.trim();
    const categoryPath = query.categoryPath?.trim();
    const where: Prisma.ProductWhereInput = {
      tenantId: tid,
      ...(query.status
        ? { status: query.status }
        : query.reviewOnly
          ? { status: { in: PRODUCT_REVIEW_QUEUE_STATUSES } }
          : query.catalogOnly
            ? { status: { in: PRODUCT_CATALOG_STATUSES } }
            : {}),
      ...(query.wbListingStatus ? { wbListingStatus: query.wbListingStatus } : {}),
      ...(categoryPath
        ? { categoryPath: { contains: categoryPath, mode: 'insensitive' } }
        : {}),
      ...(query.shopId
        ? { shopListings: { some: { tenantId: tid, shopId: query.shopId } } }
        : {}),
      ...(query.recommended === true || query.recommended === false
        ? { aiSelection: { is: { recommended: query.recommended } } }
        : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { skuId: { contains: keyword, mode: 'insensitive' } },
              { wbVendorCode: { contains: keyword, mode: 'insensitive' } },
              { skuOptions: { string_contains: keyword } },
            ],
          }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          aiSelection: true,
          shopListings: {
            include: { shop: { select: { id: true, name: true, platform: true, status: true } } },
            orderBy: { updatedAt: 'desc' },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    const merged = await this.attachFamilyList(tid, list);
    return { list: merged, total, page: query.page, pageSize: query.pageSize };
  }

  async detail(tenantId: string | null, id: string) {
    const tid = requireTenantId(tenantId);
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId: tid },
      include: {
        aiSelection: true,
        reviews: { orderBy: { createdAt: 'desc' }, take: 20 },
        shopListings: {
          include: { shop: { select: { id: true, name: true, platform: true, status: true } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    const [hydrated] = await this.attachFamilyList(tid, [product]);
    return hydrated;
  }

  async update(
    tenantId: string | null,
    userId: string,
    id: string,
    dto: { name?: string; price?: number; stock?: number; remark?: string },
  ) {
    const tid = requireTenantId(tenantId);
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: tid } });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        price: dto.price,
        stock: dto.stock,
        remark: dto.remark,
      },
    });
    await this.prisma.productReview.create({
      data: {
        tenantId: tid,
        productId: id,
        reviewerId: userId,
        action: 'EDIT',
        remark: dto.remark,
        snapshot: dto as Prisma.InputJsonValue,
      },
    });
    return updated;
  }

  async review(
    tenantId: string | null,
    userId: string,
    ids: string[],
    action: Extract<ReviewAction, 'APPROVE' | 'REJECT'>,
    remark?: string,
  ) {
    const tid = requireTenantId(tenantId);
    if (ids.length === 0) {
      throw new BadRequestException('请选择商品');
    }
    const products = await this.prisma.product.findMany({
      where: { tenantId: tid, id: { in: ids } },
    });
    if (products.length !== ids.length) {
      throw new BadRequestException('存在不属于当前租户的商品');
    }

    const nextStatus: ProductStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.$transaction(
      products.flatMap((product) => [
        this.prisma.product.update({
          where: { id: product.id },
          data: { status: nextStatus, remark: remark ?? product.remark },
        }),
        this.prisma.productReview.create({
          data: {
            tenantId: tid,
            productId: product.id,
            reviewerId: userId,
            action,
            remark,
          },
        }),
      ]),
    );
    return { count: products.length };
  }

  async shelf(actor: AuthUser, tenantId: string | null, id: string, options: ShelfOptions) {
    return this.shelfMany(actor, tenantId, [id], options);
  }

  async shelfMany(actor: AuthUser, tenantId: string | null, ids: string[], options: ShelfOptions) {
    const tid = requireTenantId(tenantId);
    if (!ids.length) {
      throw new BadRequestException('请选择商品');
    }
    const loaded = await this.prisma.product.findMany({
      where: { tenantId: tid, id: { in: ids } },
      include: { shopListings: true },
    });
    if (loaded.length !== ids.length) {
      throw new BadRequestException('存在不属于当前租户的商品');
    }
    const products = await this.attachFamilyList(tid, loaded);
    const shops = await this.shopAccess.assertShopsAccessible(actor, tid, options.shopIds, {
      platform: 'WILDBERRIES',
      requireEnabledToken: true,
    });
    if (!options.onShelf) {
      let unlisted = 0;
      for (const product of products) {
        const targets = shops.filter((shop) => {
          const item = product.shopListings.find((listing) => listing.shopId === shop.id);
          return Boolean(item && canUnlistShopListing(item));
        });
        for (const shop of targets) {
          await this.unlistFromShop(product.id, shop);
          unlisted += 1;
        }
      }
      if (!unlisted) {
        throw new BadRequestException('所选店铺没有可下架的记录');
      }
      return products.length === 1 ? this.loadProduct(tid, products[0].id) : { count: products.length };
    }

    for (const product of products) {
      if (!['APPROVED', 'OFF_SHELF', 'ON_SHELF'].includes(product.status)) {
        throw new BadRequestException(`商品 ${product.skuId} 未审核通过，不能上架`);
      }
      const priced = computeWbShelfPrice({
        price: Number(product.price),
        originalPrice: product.originalPrice == null ? null : Number(product.originalPrice),
        discountPrice: this.decimalOrNull((product as { discountPrice?: unknown }).discountPrice),
        mode: options.priceMode || 'keep',
        multiplier: options.priceMultiplier,
        saleMultiplier: options.saleMultiplier,
        listSource: options.listSource,
        saleSource: options.saleSource,
        fixedPrice: options.fixedPrice,
        listPrice: options.listPrice,
        salePrice: options.salePrice ?? options.price,
        discountPercent: options.discountPercent,
        fixedListPrice: options.fixedListPrice,
        fixedSalePrice: options.fixedSalePrice,
        fixedDiscountPercent: options.fixedDiscountPercent,
      });
      const price = priced.salePrice;
      const stock = computeShelfStock(options.stock, product.stock);
      const skuPrices = this.priceSkuOptions(product, options);
      const skuIds = this.resolveShelfSkuIds(product, options.skuIds);
      await this.prisma.product.update({
        where: { id: product.id },
        data: { price, stock },
      });
      for (const shop of shops) {
        await this.enqueueShopListing(tid, product.id, shop.id, {
          price,
          listPrice: priced.listPrice,
          discount: priced.discount,
          stock,
          skuIds,
          skuPrices,
        });
      }
    }
    return products.length === 1 ? this.loadProduct(tid, products[0].id) : { count: products.length };
  }

  async processWbListing(input: WbListingJob) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, tenantId: input.tenantId },
    });
    const shop = await this.prisma.platformAccount.findFirst({
      where: { id: input.shopId, tenantId: input.tenantId },
    });
    if (!product || !shop) {
      return;
    }
    if (shop.status !== 'ENABLED' || !shop.encryptedSecret) {
      throw new UnrecoverableError(`店铺「${shop.name}」未启用或未配置 API Token`);
    }
    const existing = await this.prisma.productShopListing.findUnique({
      where: { productId_shopId: { productId: product.id, shopId: shop.id } },
    });
    if (existing?.status === 'UNLISTED') {
      this.logger.log(`skip cancelled listing product=${product.id} shop=${shop.id}`);
      return;
    }
    await this.prisma.productShopListing.upsert({
      where: { productId_shopId: { productId: product.id, shopId: shop.id } },
      update: { status: 'PROCESSING', error: null },
      create: { tenantId: input.tenantId, productId: product.id, shopId: shop.id, status: 'PROCESSING' },
    });
    try {
      const adapter = this.createListingAdapter(shop);
      const salePrice = input.price ?? Number(product.price);
      const listPrice = input.listPrice ?? salePrice;
      const discount = input.discount ?? 0;
      const stock = computeShelfStock(input.stock, product.stock);
      const draft = this.toWbDraft(
        { ...product, price: listPrice, stock },
        { skuIds: input.skuIds, skuPrices: input.skuPrices },
      );
      const listed = await adapter.listProduct(draft);
      let nmId = listed.nmId;
      let imtId = listed.imtId;
      if (!nmId) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await this.sleep(8000);
          const errors = await adapter.listErrors(listed.vendorCode);
          if (errors.length) {
            throw new UnrecoverableError(errors.join('；'));
          }
          const card = await adapter.findCard(listed.vendorCode);
          if (card?.nmId) {
            nmId = card.nmId;
            imtId = card.imtId;
            break;
          }
        }
      }
      if (!nmId) {
        throw new Error('Wildberries 卡片尚未同步完成，稍后自动重试');
      }
      const cancelled = await this.prisma.productShopListing.findFirst({
        where: { productId: product.id, shopId: shop.id, status: 'UNLISTED' },
      });
      if (cancelled) {
        try {
          await this.createListingAdapter(shop).unlist([nmId]);
        } catch (error) {
          this.logger.warn(
            `cancelled listing cleanup failed product=${product.id} shop=${shop.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return;
      }
      const warnings: string[] = [...(listed.warnings || [])];
      // 新建卡同步到媒体服务通常需要 1–2 秒，立刻传图会被 400
      await this.sleep(2000);
      try {
        await adapter.saveMedia(nmId, collectImageUrls(draft));
      } catch (error) {
        warnings.push(`图片: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await adapter.setPrice(nmId, listPrice, discount);
      } catch (error) {
        warnings.push(`价格: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        let barcodes = listed.barcodes?.filter(Boolean) || [];
        if (!barcodes.length) {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await this.sleep(4000);
            const card = await adapter.findCard(listed.vendorCode);
            barcodes = card?.sizes?.flatMap((item) => item.skus).filter(Boolean) || [];
            if (barcodes.length) {
              break;
            }
          }
        }
        if (!barcodes.length) {
          throw new Error('卡片条码尚未同步，无法写入库存（请稍后重新上架同步库存）');
        }
        // 新建卡后库存接口可能尚未就绪，稍等再写
        await this.sleep(3000);
        const warehouseId = await adapter.setStocks(barcodes, stock, this.shopWarehouseId(shop));
        await this.rememberShopWarehouse(shop.id, warehouseId);
        if (stock <= 0) {
          warnings.push('库存为 0：已同步到 WB，商品仍无法售卖，请在上架弹窗填写库存');
        }
      } catch (error) {
        warnings.push(`库存: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.prisma.productShopListing.update({
        where: { productId_shopId: { productId: product.id, shopId: shop.id } },
        data: {
          status: 'LISTED',
          error: warnings.length ? warnings.join('；') : null,
          wbNmId: BigInt(nmId),
          wbImtId: imtId != null ? BigInt(imtId) : null,
          wbVendorCode: listed.vendorCode,
          wbSubjectId: listed.subjectID,
          wbSubjectName: listed.subjectName,
          listedAt: new Date(),
          unlistedAt: null,
        },
      });
      await this.syncProductListingSummary(product.id);
      return this.loadProduct(input.tenantId, product.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        (error instanceof WbHttpError && error.retryable) || /HTTP 429|尚未同步完成|网络请求失败|fetch failed/i.test(message);
      const unrecoverable =
        error instanceof UnrecoverableError ||
        isWbVendorCodeConflict(message) ||
        /无法匹配|缺少|未配置|无法解密|重新保存 Token|密文已损坏|必填|не более \d+ символов|Описание|description|бренд.*не найден|безразмерн|Размер и Рос/i.test(
          message,
        );
      await this.prisma.productShopListing.updateMany({
        where: { productId: product.id, shopId: shop.id, tenantId: input.tenantId },
        data: {
          status: retryable && !unrecoverable ? 'PROCESSING' : 'FAILED',
          error: retryable && !unrecoverable ? `WB 接口繁忙，正在重试: ${message}` : message,
        },
      });
      await this.syncProductListingSummary(product.id);
      this.logger.error(`WB listing failed product=${product.id} shop=${shop.id} ${message}`);
      if (unrecoverable || !retryable) {
        throw new UnrecoverableError(message);
      }
      throw error;
    }
  }

  async runAiSelection(input: { tenantId: string; snapshotId: string; productId: string; aiId: string }) {
    const snapshot = await this.prisma.productSnapshot.findFirst({
      where: { id: input.snapshotId, tenantId: input.tenantId },
    });
    if (!snapshot) {
      return;
    }
    await this.prisma.aiSelection.update({ where: { id: input.aiId }, data: { status: 'RUNNING' } });

    const product = {
      skuId: snapshot.skuId,
      name: snapshot.name,
      sourceUrl: snapshot.sourceUrl,
      mainImageUrl: snapshot.mainImageUrl ?? undefined,
      imageUrls: snapshot.imageUrls,
      price: Number(snapshot.price),
      currency: snapshot.currency,
      stock: snapshot.stock,
      specs: (snapshot.specs as Array<{ name: string; value: string }>) ?? [],
      categoryPath: snapshot.categoryPath ?? undefined,
      rating: snapshot.rating ? Number(snapshot.rating) : undefined,
      salesCount: snapshot.salesCount,
    };

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('未配置 LLM_API_KEY，无法进行真实 AI 选品');
    }
    const provider = new OpenAiCompatibleProvider({
      apiKey,
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      providerName: process.env.LLM_PROVIDER || 'openai-compatible',
    });

    try {
      const raw = await provider.completeJson(buildSelectionPrompt(product));
      const result = parseSelectionOutput(raw);
      await this.prisma.aiSelection.update({
        where: { id: input.aiId },
        data: {
          status: 'SUCCESS',
          score: result.score,
          profitEstimate: result.profitEstimate,
          profitCurrency: result.profitCurrency,
          riskPoints: result.riskPoints,
          fitReason: result.fitReason,
          unfitReason: result.unfitReason,
          recommended: result.recommended,
          modelProvider: provider.provider,
          modelName: provider.model,
          promptVersion: SELECTION_PROMPT_VERSION,
          rawResponse: raw as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      await this.prisma.product.update({
        where: { id: input.productId },
        data: { status: 'REVIEW_PENDING' },
      });
    } catch (error) {
      await this.prisma.aiSelection.update({
        where: { id: input.aiId },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      await this.prisma.product.update({
        where: { id: input.productId },
        data: { status: 'AI_DONE' },
      });
    }
  }

  private toWbDraft(
    product: {
      skuId: string;
      name: string;
      brand: string | null;
      description: string | null;
      categoryPath: string | null;
      price: unknown;
      stock?: number;
      mainImageUrl: string | null;
      imageUrls: string[];
      specs: unknown;
      skuOptions: unknown;
    },
    listing?: { skuIds?: string[]; skuPrices?: Array<{ skuId: string; listPrice: number }> },
  ): WbProductDraft {
    // skuIds / skuPrices 来自上架任务，保证同一 SPU 下多 Ozon SKU 写入同一张 WB 卡
    const skuOptions = this.filterSkuOptions(this.asSkuOptions(product.skuOptions), listing?.skuIds, product.skuId);
    const priceBySku = new Map((listing?.skuPrices || []).map((item) => [item.skuId, item.listPrice]));
    const matched = skuOptions.find((item) => item.skuId === product.skuId) || skuOptions[0];
    const specDescription = this.asSpecs(product.specs).find((item) => item.name === '商品描述')?.value;
    return {
      skuId: product.skuId,
      name: product.name,
      brand: product.brand,
      description: product.description || specDescription || null,
      categoryPath: product.categoryPath,
      price: Number(product.price),
      stock: typeof product.stock === 'number' ? product.stock : undefined,
      imageUrls: [
        product.mainImageUrl,
        ...product.imageUrls,
        ...(matched && Array.isArray((matched as { imageUrls?: string[] }).imageUrls)
          ? (matched as { imageUrls: string[] }).imageUrls
          : []),
      ].filter((item): item is string => Boolean(item)),
      specs: this.asSpecs(product.specs),
      skuOptions: skuOptions.map((item) => ({
        skuId: item.skuId,
        name: item.name,
        price: priceBySku.get(item.skuId) ?? item.price,
        options: item.options,
        imageUrls: Array.isArray((item as { imageUrls?: string[] }).imageUrls)
          ? (item as { imageUrls: string[] }).imageUrls
          : [],
      })),
    };
  }

  private resolveShelfSkuIds(
    product: { skuId: string; skuOptions: unknown },
    skuIds?: string[],
  ): string[] {
    const options = this.asSkuOptions(product.skuOptions);
    const all = familySkuIds({ skuId: product.skuId, skuOptions: options });
    if (!skuIds?.length) {
      return all;
    }
    const allow = new Set(skuIds.map((item) => String(item).trim()).filter(Boolean));
    const selected = all.filter((item) => allow.has(item));
    if (!selected.length) {
      throw new BadRequestException(`商品 ${product.skuId} 未匹配到可上架规格`);
    }
    return selected;
  }

  private filterSkuOptions(skuOptions: ProductSkuOption[], skuIds: string[] | undefined, fallbackSkuId: string): ProductSkuOption[] {
    const source = skuOptions.length
      ? skuOptions
      : [
          {
            skuId: fallbackSkuId,
            name: fallbackSkuId,
            sourceUrl: '',
            price: 0,
            imageUrls: [],
            options: {},
          },
        ];
    if (!skuIds?.length) {
      return source;
    }
    const allow = new Set(skuIds);
    const selected = source.filter((item) => allow.has(item.skuId));
    return selected.length ? selected : source;
  }

  private priceSkuOptions(
    product: {
      skuId: string;
      price: unknown;
      originalPrice: unknown;
      discountPrice?: unknown;
      skuOptions: unknown;
    },
    options: ShelfOptions,
  ): Array<{ skuId: string; listPrice: number }> {
    const skuOptions = this.filterSkuOptions(this.asSkuOptions(product.skuOptions), options.skuIds, product.skuId);
    return skuOptions.map((item) => {
      const priced = computeWbShelfPrice({
        price: Number(item.price || product.price),
        originalPrice:
          item.originalPrice == null
            ? product.originalPrice == null
              ? null
              : Number(product.originalPrice)
            : Number(item.originalPrice),
        discountPrice:
          item.discountPrice == null
            ? product.discountPrice == null
              ? null
              : Number(product.discountPrice)
            : Number(item.discountPrice),
        mode: options.priceMode || 'keep',
        multiplier: options.priceMultiplier,
        saleMultiplier: options.saleMultiplier,
        listSource: options.listSource,
        saleSource: options.saleSource,
        fixedPrice: options.fixedPrice,
        listPrice: options.listPrice,
        salePrice: options.salePrice ?? options.price,
        discountPercent: options.discountPercent,
        fixedListPrice: options.fixedListPrice,
        fixedSalePrice: options.fixedSalePrice,
        fixedDiscountPercent: options.fixedDiscountPercent,
      });
      return { skuId: item.skuId, listPrice: priced.listPrice };
    });
  }

  private async enqueueShopListing(
    tenantId: string,
    productId: string,
    shopId: string,
    listing?: {
      price?: number;
      listPrice?: number;
      discount?: number;
      stock?: number;
      skuIds?: string[];
      skuPrices?: Array<{ skuId: string; listPrice: number }>;
    },
  ) {
    const existing = await this.prisma.productShopListing.findUnique({
      where: { productId_shopId: { productId, shopId } },
    });
    if (existing?.status === 'QUEUED' || existing?.status === 'PROCESSING') {
      throw new BadRequestException('该商品正在上架到所选店铺，请稍后刷新');
    }
    await this.prisma.productShopListing.upsert({
      where: { productId_shopId: { productId, shopId } },
      update: { status: 'QUEUED', error: null },
      create: { tenantId, productId, shopId, status: 'QUEUED' },
    });
    try {
      if (!this.listingQueue) {
        return this.processWbListing({ tenantId, productId, shopId, ...listing });
      }
      await this.listingQueue.add(
        'list',
        { tenantId, productId, shopId, ...listing },
        {
          jobId: `wb-list-${productId}-${shopId}`,
          attempts: 6,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists|JobId/i.test(message)) {
        throw new BadRequestException('该商品正在上架到所选店铺，请稍后刷新');
      }
      await this.prisma.productShopListing.updateMany({
        where: { productId, shopId, tenantId, status: 'QUEUED' },
        data: { status: 'FAILED', error: message },
      });
      await this.syncProductListingSummary(productId);
      throw error instanceof BadRequestException ? error : new BadRequestException(message);
    }
    await this.syncProductListingSummary(productId);
    return this.prisma.productShopListing.findUnique({
      where: { productId_shopId: { productId, shopId } },
    });
  }

  private async unlistFromShop(productId: string, shop: PlatformAccount) {
    const listing = await this.prisma.productShopListing.findUnique({
      where: { productId_shopId: { productId, shopId: shop.id } },
    });
    if (!listing || !canUnlistShopListing(listing)) {
      return;
    }
    if (listing.wbNmId) {
      try {
        await this.createListingAdapter(shop).unlist([Number(listing.wbNmId)]);
      } catch (error) {
        throw new BadRequestException(
          `店铺「${shop.name}」下架失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.prisma.productShopListing.update({
      where: { id: listing.id },
      data: {
        status: 'UNLISTED',
        unlistedAt: new Date(),
      },
    });
    await this.syncProductListingSummary(productId);
  }

  private async syncProductListingSummary(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return;
    }
    const listings = await this.prisma.productShopListing.findMany({
      where: { productId },
      orderBy: [{ listedAt: 'desc' }, { updatedAt: 'desc' }],
    });
    const listed = listings.filter((item) => item.status === 'LISTED');
    const busy = listings.find((item) => item.status === 'QUEUED' || item.status === 'PROCESSING');
    const failed = listings.find((item) => item.status === 'FAILED');
    const latest = listed[0] ?? busy ?? failed ?? listings[0];
    const summaryStatus = busy
      ? busy.status
      : listed.length
        ? 'LISTED'
        : failed
          ? 'FAILED'
          : listings.some((item) => item.status === 'UNLISTED')
            ? 'UNLISTED'
            : 'NONE';
    const nextStatus = listed.length ? 'ON_SHELF' : product.status === 'ON_SHELF' ? 'OFF_SHELF' : product.status;
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: nextStatus,
        onShelfAt: listed.length ? (product.onShelfAt ?? new Date()) : product.onShelfAt,
        offShelfAt: listed.length ? null : nextStatus === 'OFF_SHELF' ? (product.offShelfAt ?? new Date()) : product.offShelfAt,
        wbNmId: latest?.wbNmId ?? null,
        wbImtId: latest?.wbImtId ?? null,
        wbVendorCode: latest?.wbVendorCode ?? null,
        wbSubjectId: latest?.wbSubjectId ?? null,
        wbSubjectName: latest?.wbSubjectName ?? null,
        wbListingStatus: summaryStatus,
        wbListingError: latest?.error ?? null,
        wbListedAt: latest?.listedAt ?? null,
      },
    });
  }

  private async loadProduct(tenantId: string, id: string) {
    return this.detail(tenantId, id);
  }

  private createListingAdapter(shop: PlatformAccount) {
    return createWbListingAdapter({
      token: this.shopAccess.decryptShopToken(shop),
      contentBase: process.env.WB_CONTENT_API_BASE,
      pricesBase: process.env.WB_PRICES_API_BASE,
      marketplaceBase: process.env.WB_MARKETPLACE_API_BASE,
      defaultSubjectId: process.env.WB_DEFAULT_SUBJECT_ID ? Number(process.env.WB_DEFAULT_SUBJECT_ID) : undefined,
      warehouseId: this.shopWarehouseId(shop),
      defaultBrand: this.shopBrand(shop),
      locale: process.env.WB_LOCALE || 'ru',
    });
  }

  private shopWarehouseId(shop: PlatformAccount): number | undefined {
    const extra = this.asShopExtra(shop.extra);
    const fromShop = Number(extra.warehouseId);
    if (Number.isFinite(fromShop) && fromShop > 0) {
      return fromShop;
    }
    const fromEnv = Number(process.env.WB_WAREHOUSE_ID);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : undefined;
  }

  private shopBrand(shop: PlatformAccount): string | undefined {
    const extra = this.asShopExtra(shop.extra);
    const brand = typeof extra.brand === 'string' ? extra.brand.trim() : '';
    return brand || undefined;
  }

  private async rememberShopWarehouse(shopId: string, warehouseId: number) {
    const shop = await this.prisma.platformAccount.findUnique({ where: { id: shopId } });
    if (!shop) {
      return;
    }
    const extra = this.asShopExtra(shop.extra);
    if (Number(extra.warehouseId) === warehouseId) {
      return;
    }
    await this.prisma.platformAccount.update({
      where: { id: shopId },
      data: { extra: { ...extra, warehouseId } as Prisma.InputJsonValue },
    });
  }

  private asShopExtra(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  private asSpecs(value: unknown): Array<{ name: string; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is { name: string; value: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { name?: unknown }).name === 'string' &&
        typeof (item as { value?: unknown }).value === 'string',
    );
  }

  private sleep(ms: number) {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  private asSkuOptions(value: unknown): ProductSkuOption[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is ProductSkuOption => Boolean(item) && typeof item === 'object' && typeof (item as ProductSkuOption).skuId === 'string',
    );
  }

  private decimalOrNull(value: unknown): number | null {
    if (value == null) {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** 不再把多规格合并进列表：每条商品只保留自己的主 skuId */
  private async attachFamilyList<T>(
    _tenantId: string,
    products: T[],
  ): Promise<T[]> {
    return products;
  }
}
