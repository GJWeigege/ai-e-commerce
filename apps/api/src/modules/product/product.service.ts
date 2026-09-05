import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import { PlatformAccount, ProductStatus, Prisma, WbListingStatus } from '@prisma/client';
import {
  familySkuIds,
  ProductSkuOption,
} from '@aiecom/shared';
import {
  OpenAiCompatibleProvider,
  PACKAGE_ESTIMATE_PROMPT_VERSION,
  SELECTION_PROMPT_VERSION,
  buildPackageEstimatePrompt,
  buildSelectionPrompt,
  inspectEstimateProduct,
  mergeEstimatedPackageSpecs,
  parseJsonFromAgentText,
  parsePackageEstimateOutput,
  parseSelectionOutput,
  refinePackedEstimate,
  stripAiPackageSpecs,
} from '@aiecom/llm-core';
import {
  collectImageUrls,
  collectWbChrtIds,
  inferWbCargoType,
  isWbVendorCodeConflict,
  mapWbDimensions,
  WbHttpError,
  WbListingHints,
  WbProductDraft,
} from '@aiecom/platform-core';
import { computeShelfStock, computeWbShelfPrice, PriceSource, ShelfPriceMode } from './shelf-price';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { ShopAccessService } from '../../common/shop/shop-access.service';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { QUEUE_WB_LISTING } from '../../queues/queue.constants';
import { AuthUser } from '../auth/auth.types';
import { canListProduct, canUnlistShopListing, PRODUCT_CATALOG_STATUSES } from './product-status';
import { CursorAgentClient } from './cursor-agent.client';
import { EstimatePackageDto } from './dto/estimate-package.dto';
import { WbCategoryMappingService } from './wb-category-mapping.service';
import { WbListingAdapterFactory } from './wb-listing-adapter.factory';

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
  /** 上架时指定的 WB 类目，写入映射表并跳过检索 */
  wbSubjectId?: number;
  wbSubjectName?: string;
  sized?: boolean | null;
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
  wbSubjectId?: number;
  wbSubjectName?: string;
  sized?: boolean | null;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
    private readonly categoryMappings: WbCategoryMappingService,
    private readonly adapters: WbListingAdapterFactory,
    private readonly cursorAgent: CursorAgentClient,
    @Optional() @InjectQueue(QUEUE_WB_LISTING) private readonly listingQueue?: Queue,
  ) {}

  async page(
    tenantId: string | null,
    query: PageQueryDto & {
      status?: ProductStatus;
      keyword?: string;
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

  async estimatePackage(
    tenantId: string | null,
    userId: string,
    id: string,
    dto: EstimatePackageDto = {},
  ) {
    const tid = requireTenantId(tenantId);
    const persist = dto.persist !== false;
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: tid } });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }
    const result = await this.estimateProductRecord(product, dto.force === true);
    if (persist && !result.skipped && result.specs) {
      await this.prisma.product.update({
        where: { id },
        data: { specs: result.specs as Prisma.InputJsonValue },
      });
      await this.prisma.productReview.create({
        data: {
          tenantId: tid,
          productId: id,
          reviewerId: userId,
          action: 'EDIT',
          remark: result.estimate.reason || 'AI 预估包裹尺寸/重量',
          snapshot: {
            source: 'cursor-sdk',
            promptVersion: PACKAGE_ESTIMATE_PROMPT_VERSION,
            estimate: result.estimate,
            runId: result.runId,
          } as Prisma.InputJsonValue,
        },
      });
    }
    const hydrated = await this.detail(tid, id);
    return {
      product: hydrated,
      estimate: result.estimate,
      gaps: result.gaps,
      persisted: persist && !result.skipped,
      skipped: result.skipped,
    };
  }

  async estimatePackageBatch(
    tenantId: string | null,
    userId: string,
    productIds: string[],
    dto: EstimatePackageDto = {},
  ) {
    const tid = requireTenantId(tenantId);
    const unique = [...new Set(productIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('请选择要预估的商品');
    }
    if (unique.length > 20) {
      throw new BadRequestException('单次最多预估 20 件商品');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique }, tenantId: tid },
      select: { id: true, skuId: true, name: true },
    });
    if (products.length !== unique.length) {
      throw new NotFoundException('部分商品不存在或无权访问');
    }
    const byId = new Map(products.map((item) => [item.id, item]));
    const list: Array<{
      productId: string;
      skuId: string;
      name: string;
      ok: boolean;
      skipped?: boolean;
      persisted?: boolean;
      error?: string;
      estimate?: unknown;
      gaps?: unknown;
    }> = [];
    for (const id of unique) {
      const meta = byId.get(id)!;
      try {
        const result = await this.estimatePackage(tid, userId, id, dto);
        list.push({
          productId: id,
          skuId: meta.skuId,
          name: meta.name,
          ok: true,
          skipped: result.skipped,
          persisted: result.persisted,
          estimate: result.estimate,
          gaps: result.gaps,
        });
      } catch (error) {
        list.push({
          productId: id,
          skuId: meta.skuId,
          name: meta.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { list };
  }

  async remove(tenantId: string | null, ids: string[]): Promise<{ count: number }> {
    const tid = requireTenantId(tenantId);
    const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('请选择要删除的商品');
    }
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique }, tenantId: tid },
      include: { shopListings: { select: { status: true, wbNmId: true } } },
    });
    if (products.length !== unique.length) {
      throw new NotFoundException('部分商品不存在或无权访问');
    }
    const busy = products.some(
      (item) =>
        item.wbListingStatus === 'QUEUED' ||
        item.wbListingStatus === 'PROCESSING' ||
        item.shopListings.some((listing) => listing.status === 'QUEUED' || listing.status === 'PROCESSING'),
    );
    if (busy) {
      throw new BadRequestException('上架进行中的商品无法删除，请稍后再试');
    }
    const liveOnWb = products.some((item) =>
      item.shopListings.some(
        (listing) => listing.status === 'LISTED' || (listing.status === 'FAILED' && listing.wbNmId != null),
      ),
    );
    if (liveOnWb) {
      throw new BadRequestException('已上架或仍有 WB 卡片的商品无法删除，请先下架');
    }
    const ordered = await this.prisma.salesOrder.count({
      where: { tenantId: tid, productId: { in: unique } },
    });
    if (ordered > 0) {
      throw new BadRequestException('已有销售订单的商品无法从库中删除');
    }
    await this.prisma.$transaction([
      this.prisma.aiSelection.updateMany({ where: { tenantId: tid, productId: { in: unique } }, data: { productId: null } }),
      this.prisma.productReview.deleteMany({ where: { tenantId: tid, productId: { in: unique } } }),
      this.prisma.productShopListing.deleteMany({ where: { tenantId: tid, productId: { in: unique } } }),
      this.prisma.product.deleteMany({ where: { tenantId: tid, id: { in: unique } } }),
    ]);
    return { count: unique.length };
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

    if (options.wbSubjectId && options.wbSubjectName) {
      const uniquePaths = [...new Set(products.map((item) => item.categoryPath).filter(Boolean))] as string[];
      await Promise.all(
        uniquePaths.map((categoryPath) =>
          this.categoryMappings.upsert(tid, {
            ozonCategoryPath: categoryPath,
            wbSubjectId: options.wbSubjectId!,
            wbSubjectName: options.wbSubjectName!,
            remark: '上架时指定',
          }),
        ),
      );
    }

    for (const product of products) {
      if (!canListProduct(product.status)) {
        throw new BadRequestException(`商品 ${product.skuId} 不在商品库可上架状态`);
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
          wbSubjectId: options.wbSubjectId,
          wbSubjectName: options.wbSubjectName,
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
      const adapter = this.adapters.create(shop);
      const salePrice = input.price ?? Number(product.price);
      const listPrice = input.listPrice ?? salePrice;
      const discount = input.discount ?? 0;
      const stock = computeShelfStock(input.stock, product.stock);
      const draft = this.toWbDraft(
        { ...product, price: listPrice, stock },
        { skuIds: input.skuIds, skuPrices: input.skuPrices },
      );
      const hints = await this.buildListingHints(input, product.categoryPath, existing?.wbNmId);
      const listed = await adapter.listProduct(draft, hints);
      // 类目 + 尺码口径回写映射表：同类目后续商品直接命中，不再检索也不再踩同一个拒卡
      await this.categoryMappings.remember({
        tenantId: input.tenantId,
        categoryPath: product.categoryPath,
        subjectId: listed.subjectID,
        subjectName: listed.subjectName,
        sized: listed.sized,
        learned: Boolean(listed.repairs?.length),
      });
      let nmId = listed.nmId;
      let imtId = listed.imtId;
      if (!nmId) {
        // 适配器已确认无拒卡原因，这里只等 WB 队列把卡片落库
        for (const delay of [400, 1000, 1800]) {
          await this.sleep(delay);
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
          await adapter.unlist([nmId]);
        } catch (error) {
          this.logger.warn(
            `cancelled listing cleanup failed product=${product.id} shop=${shop.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return;
      }
      const warnings: string[] = [...(listed.repairs || []), ...(listed.warnings || [])];
      // 图片走 content 域、价格走 discounts-prices 域，是两套独立限流，并行不会互相拖慢
      const [mediaResult, priceResult] = await Promise.allSettled([
        adapter.saveMedia(nmId, collectImageUrls(draft)),
        adapter.setPrice(nmId, listPrice, discount),
      ]);
      if (mediaResult.status === 'rejected') {
        warnings.push(`图片: ${this.errorText(mediaResult.reason)}`);
      }
      if (priceResult.status === 'rejected') {
        warnings.push(`价格: ${this.errorText(priceResult.reason)}`);
      }
      try {
        // WB 2026-05-20 起库存只认 chrtId，条码 sku 会直接 400
        let chrtIds = collectWbChrtIds((listed.chrtIds || []).map((chrtId) => ({ chrtId })));
        if (!chrtIds.length) {
          for (const delay of [400, 1000]) {
            await this.sleep(delay);
            const card = await adapter.findCard(listed.vendorCode);
            chrtIds = collectWbChrtIds(card?.sizes);
            if (chrtIds.length) {
              break;
            }
          }
        }
        if (!chrtIds.length) {
          throw new Error('卡片尺码 ID（chrtId）尚未同步，无法写入库存（请稍后重新上架同步库存）');
        }
        const cargoType = inferWbCargoType(mapWbDimensions(draft.specs, draft));
        // 大件必须写到 ODC/CD+ 仓；记住的小件仓会触发 CargoWarehouseRestrictionSGTKGTPlus
        const warehouseId = await adapter.setStocks(
          chrtIds,
          stock,
          this.adapters.warehouseId(shop, cargoType),
          cargoType,
        );
        await this.adapters.rememberWarehouse(shop.id, warehouseId, cargoType);
        if (stock <= 0) {
          warnings.push('库存为 0：已同步到 WB，商品仍无法售卖，请在上架弹窗填写库存');
        }
      } catch (error) {
        warnings.push(`库存: ${this.errorText(error)}`);
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
        /无法匹配|缺少|未配置|无法解密|重新保存 Token|密文已损坏|必填|не более \d+ символов|Описание|description|безразмерн|Размер и Рос/i.test(
          message,
        );
      await this.categoryMappings.recordFailure(input.tenantId, product.categoryPath, message);
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
    } catch (error) {
      await this.prisma.aiSelection.update({
        where: { id: input.aiId },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      await this.touchAiProductStatus(input.productId, 'AI_DONE');
    }
  }

  /** 上架弹窗指定 > 类目映射表 > 自动检索；已知 nmID 则跳过货号反查与回收站恢复 */
  private async buildListingHints(
    input: Pick<WbListingJob, 'tenantId' | 'wbSubjectId' | 'wbSubjectName' | 'sized'>,
    categoryPath: string | null,
    knownNmId?: bigint | null,
  ): Promise<WbListingHints> {
    const mapping = await this.categoryMappings.resolve(input.tenantId, categoryPath).catch(() => null);
    const subject =
      input.wbSubjectId && input.wbSubjectName
        ? { subjectID: input.wbSubjectId, subjectName: input.wbSubjectName }
        : mapping?.subject;
    // 尺码按单件规格判定，不把类目映射里的 sized 当硬开关（同一 Ozon 类目下既有带尺码也有均码）
    return {
      ...(subject ? { subject } : {}),
      knownNmId: knownNmId == null ? null : Number(knownNmId),
      skipTrashLookup: knownNmId == null,
    };
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
      wbSubjectId?: number;
      wbSubjectName?: string;
      sized?: boolean | null;
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
        await this.adapters.create(shop).unlist([Number(listing.wbNmId)]);
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

  private async estimateProductRecord(
    product: {
      id: string;
      skuId: string;
      name: string;
      categoryPath: string | null;
      brand: string | null;
      description: string | null;
      specs: Prisma.JsonValue;
      skuOptions: Prisma.JsonValue;
    },
    force: boolean,
  ) {
    const specs = force ? stripAiPackageSpecs(this.asSpecs(product.specs)) : this.asSpecs(product.specs);
    const skuOptions = this.asSkuOptions(product.skuOptions);
    const input = {
      skuId: product.skuId,
      name: product.name,
      categoryPath: product.categoryPath,
      brand: product.brand,
      description: product.description,
      specs,
      skuOptions,
    };
    const gaps = inspectEstimateProduct(input);
    if (!gaps.missingSize && !gaps.missingWeight) {
      return {
        skipped: true,
        specs,
        gaps,
        runId: '',
        estimate: {
          ...gaps.dimensions,
          confidence: 1,
          categoryHint: product.categoryPath || '',
          reason: '采集已包含完整尺寸和重量，未调用 Cursor Agent',
          assumptions: [],
          source: 'collected',
          model: '',
        },
      };
    }
    const prompt = buildPackageEstimatePrompt(input, gaps);
    const agent = await this.cursorAgent.completeText(prompt);
    const parsed = refinePackedEstimate(input, parsePackageEstimateOutput(parseJsonFromAgentText(agent.text)));
    if (gaps.missingSize && !(parsed.length && parsed.width && parsed.height)) {
      throw new BadRequestException('Cursor Agent 未给出完整包装长宽高');
    }
    if (gaps.missingWeight && !parsed.weightBrutto) {
      throw new BadRequestException('Cursor Agent 未给出包装毛重');
    }
    const merged = mergeEstimatedPackageSpecs(specs, parsed, gaps, {
      source: 'cursor-sdk',
      model: agent.model,
    });
    return {
      skipped: false,
      specs: merged,
      gaps: inspectEstimateProduct({ ...input, specs: merged }),
      runId: agent.runId,
      estimate: {
        ...parsed,
        source: 'cursor-sdk',
        model: agent.model,
        promptVersion: PACKAGE_ESTIMATE_PROMPT_VERSION,
        runId: agent.runId,
      },
    };
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

  /** AI 评分不把已入库/已上架商品打回复审队列 */
  private async touchAiProductStatus(productId: string, next: ProductStatus) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { status: true } });
    if (!product || ['APPROVED', 'ON_SHELF', 'OFF_SHELF'].includes(product.status)) {
      return;
    }
    await this.prisma.product.update({ where: { id: productId }, data: { status: next } });
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
