import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PlatformAccount, PlatformAccountStatus, PlatformCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../../modules/auth/auth.types';
import { canAccessAllTenantShops, requireTenantId } from '../tenant/tenant-scope';
import { decryptSecret } from '../crypto/credential-crypto';

const TENANT_SELECT = { id: true, name: true, code: true } as const;

export type PublicShop = {
  id: string;
  tenantId: string;
  platform: PlatformCode;
  name: string;
  status: PlatformAccountStatus;
  hasToken: boolean;
  extra: unknown;
  createdAt: Date;
  updatedAt: Date;
  tenant?: { id: string; name: string; code: string };
};

type ShopWithTenant = PlatformAccount & {
  tenant?: { id: string; name: string; code: string };
};

@Injectable()
export class ShopAccessService {
  constructor(private readonly prisma: PrismaService) {}

  toPublic(shop: ShopWithTenant): PublicShop {
    return {
      id: shop.id,
      tenantId: shop.tenantId,
      platform: shop.platform,
      name: shop.name,
      status: shop.status,
      hasToken: Boolean(shop.encryptedSecret),
      extra: shop.extra,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
      tenant: shop.tenant,
    };
  }

  async listAccessibleShops(
    actor: AuthUser,
    tenantId: string | null,
    filter?: { platform?: PlatformCode; enabledOnly?: boolean },
  ): Promise<ShopWithTenant[]> {
    const extraWhere: Prisma.PlatformAccountWhereInput = {
      ...(filter?.platform ? { platform: filter.platform } : {}),
      ...(filter?.enabledOnly ? { status: 'ENABLED' as const } : {}),
    };

    if (actor.roles.includes('SUPER_ADMIN') && !tenantId) {
      return this.prisma.platformAccount.findMany({
        where: extraWhere,
        include: { tenant: { select: TENANT_SELECT } },
        orderBy: { updatedAt: 'desc' },
      });
    }

    const tid = requireTenantId(tenantId);
    const where: Prisma.PlatformAccountWhereInput = { tenantId: tid, ...extraWhere };

    if (canAccessAllTenantShops(actor.roles)) {
      return this.prisma.platformAccount.findMany({
        where,
        include: { tenant: { select: TENANT_SELECT } },
        orderBy: { updatedAt: 'desc' },
      });
    }

    const accesses = await this.prisma.userShopAccess.findMany({
      where: { tenantId: tid, userId: actor.id },
      include: { shop: { include: { tenant: { select: TENANT_SELECT } } } },
    });
    return accesses
      .map((item) => item.shop)
      .filter((shop) => {
        if (filter?.platform && shop.platform !== filter.platform) {
          return false;
        }
        if (filter?.enabledOnly && shop.status !== 'ENABLED') {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async assertShopsAccessible(
    actor: AuthUser,
    tenantId: string | null,
    shopIds: string[],
    options?: { platform?: PlatformCode; requireEnabledToken?: boolean },
  ): Promise<PlatformAccount[]> {
    const uniqueIds = [...new Set(shopIds.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('请选择店铺');
    }

    if (actor.roles.includes('SUPER_ADMIN') && !tenantId) {
      const shops = await this.prisma.platformAccount.findMany({
        where: { id: { in: uniqueIds } },
      });
      if (shops.length !== uniqueIds.length) {
        throw new ForbiddenException('店铺不存在');
      }
      this.assertShopConstraints(shops, options);
      return shops;
    }

    const tid = requireTenantId(tenantId);
    const shops = await this.prisma.platformAccount.findMany({
      where: { tenantId: tid, id: { in: uniqueIds } },
    });
    if (shops.length !== uniqueIds.length) {
      throw new ForbiddenException('存在不属于当前租户的店铺');
    }

    if (!canAccessAllTenantShops(actor.roles)) {
      const accesses = await this.prisma.userShopAccess.findMany({
        where: { tenantId: tid, userId: actor.id, shopId: { in: uniqueIds } },
        select: { shopId: true },
      });
      const allowed = new Set(accesses.map((item) => item.shopId));
      if (uniqueIds.some((id) => !allowed.has(id))) {
        throw new ForbiddenException('无权操作未分配给当前账号的店铺');
      }
    }

    this.assertShopConstraints(shops, options);
    return shops;
  }

  async assertShopsInTenant(tenantId: string, shopIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(shopIds.filter(Boolean))];
    if (!uniqueIds.length) {
      return;
    }
    const count = await this.prisma.platformAccount.count({
      where: { tenantId, id: { in: uniqueIds } },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException('存在不属于当前租户的店铺');
    }
  }

  decryptShopToken(shop: PlatformAccount): string {
    if (!shop.encryptedSecret) {
      throw new BadRequestException(`店铺「${shop.name}」尚未配置 API Token`);
    }
    return decryptSecret(shop.encryptedSecret);
  }

  private assertShopConstraints(
    shops: PlatformAccount[],
    options?: { platform?: PlatformCode; requireEnabledToken?: boolean },
  ) {
    for (const shop of shops) {
      if (options?.platform && shop.platform !== options.platform) {
        throw new BadRequestException(`店铺「${shop.name}」不是 ${options.platform} 店铺`);
      }
      if (options?.requireEnabledToken) {
        if (shop.status !== 'ENABLED') {
          throw new BadRequestException(`店铺「${shop.name}」未启用`);
        }
        if (!shop.encryptedSecret) {
          throw new BadRequestException(`店铺「${shop.name}」尚未配置 API Token`);
        }
      }
    }
  }
}
