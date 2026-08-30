import { Injectable } from '@nestjs/common';
import { PlatformAccount, Prisma } from '@prisma/client';
import { createWbListingAdapter, IWbListingAdapter, sharedWbCatalogStore } from '@aiecom/platform-core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ShopAccessService } from '../../common/shop/shop-access.service';

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** 店铺 → WB 上架适配器。上架流程与类目映射页共用一份配置，避免两处环境变量口径漂移 */
@Injectable()
export class WbListingAdapterFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
  ) {}

  create(shop: PlatformAccount): IWbListingAdapter {
    return createWbListingAdapter({
      token: this.shopAccess.decryptShopToken(shop),
      contentBase: process.env.WB_CONTENT_API_BASE,
      pricesBase: process.env.WB_PRICES_API_BASE,
      marketplaceBase: process.env.WB_MARKETPLACE_API_BASE,
      defaultSubjectId: positiveInt(process.env.WB_DEFAULT_SUBJECT_ID),
      warehouseId: this.warehouseId(shop),
      defaultBrand: this.brand(shop),
      locale: process.env.WB_LOCALE || 'ru',
      maxConcurrent: positiveInt(process.env.WB_API_MAX_CONCURRENCY),
      minIntervalMs: positiveInt(process.env.WB_API_MIN_INTERVAL_MS),
      catalogStore: sharedWbCatalogStore(),
    });
  }

  warehouseId(shop: PlatformAccount): number | undefined {
    return positiveInt(this.extra(shop.extra).warehouseId) ?? positiveInt(process.env.WB_WAREHOUSE_ID);
  }

  brand(shop: PlatformAccount): string | undefined {
    const brand = this.extra(shop.extra).brand;
    return typeof brand === 'string' && brand.trim() ? brand.trim() : undefined;
  }

  /** 首次同步库存后把探测到的仓库写回店铺，后续跳过仓库列表查询 */
  async rememberWarehouse(shopId: string, warehouseId: number): Promise<void> {
    const shop = await this.prisma.platformAccount.findUnique({ where: { id: shopId } });
    if (!shop) {
      return;
    }
    const extra = this.extra(shop.extra);
    if (Number(extra.warehouseId) === warehouseId) {
      return;
    }
    await this.prisma.platformAccount.update({
      where: { id: shopId },
      data: { extra: { ...extra, warehouseId } as Prisma.InputJsonValue },
    });
  }

  private extra(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }
}
