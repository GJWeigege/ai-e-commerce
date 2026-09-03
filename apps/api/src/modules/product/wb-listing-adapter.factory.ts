import { Injectable } from '@nestjs/common';
import { PlatformAccount, Prisma } from '@prisma/client';
import {
  createWbListingAdapter,
  IWbListingAdapter,
  nextShopWarehouseExtra,
  resolveWbPreferredWarehouseId,
  sharedWbCatalogStore,
} from '@aiecom/platform-core';
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

  /** 运营指定仓（env / extra.warehouseId）优先，避免货型记忆把库存写到泉州仓 */
  warehouseId(shop: PlatformAccount, cargoType?: number): number | undefined {
    const extra = this.extra(shop.extra);
    return resolveWbPreferredWarehouseId({
      extraWarehouseId: extra.warehouseId,
      warehousesByCargoType: this.warehousesByCargoType(extra),
      envWarehouseId: process.env.WB_WAREHOUSE_ID,
      cargoType,
    });
  }

  brand(shop: PlatformAccount): string | undefined {
    const brand = this.extra(shop.extra).brand;
    return typeof brand === 'string' && brand.trim() ? brand.trim() : undefined;
  }

  /** 按货型记住可用仓库，避免小件仓和大件仓互相覆盖后下次再踩限 */
  async rememberWarehouse(shopId: string, warehouseId: number, cargoType?: number): Promise<void> {
    const shop = await this.prisma.platformAccount.findUnique({ where: { id: shopId } });
    if (!shop) {
      return;
    }
    const extra = this.extra(shop.extra);
    const next = nextShopWarehouseExtra(extra, warehouseId, cargoType);
    const byType = this.warehousesByCargoType(extra);
    if (Number(extra.warehouseId) === next.warehouseId && JSON.stringify(byType) === JSON.stringify(next.warehousesByCargoType)) {
      return;
    }
    await this.prisma.platformAccount.update({
      where: { id: shopId },
      data: {
        extra: {
          ...extra,
          warehouseId: next.warehouseId,
          warehousesByCargoType: next.warehousesByCargoType,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private warehousesByCargoType(extra: Record<string, unknown>): Record<string, number> {
    const raw = extra.warehousesByCargoType;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const id = positiveInt(value);
      if (id) {
        result[key] = id;
      }
    }
    return result;
  }

  private extra(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }
}
