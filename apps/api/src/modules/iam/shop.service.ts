import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformAccountStatus, PlatformCode, Prisma } from '@prisma/client';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicShop, ShopAccessService } from '../../common/shop/shop-access.service';
import { encryptSecret } from '../../common/crypto/credential-crypto';
import { canManageTenantShops } from '../../common/tenant/tenant-scope';
import { AuthUser } from '../auth/auth.types';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
  ) {}

  async page(
    actor: AuthUser,
    tenantId: string | null,
    query: PageQueryDto & { platform?: PlatformCode; keyword?: string },
  ): Promise<PageResult<PublicShop>> {
    const shops = await this.shopAccess.listAccessibleShops(actor, tenantId, {
      platform: query.platform,
    });
    const keyword = query.keyword?.trim().toLowerCase();
    const filtered = keyword ? shops.filter((item) => item.name.toLowerCase().includes(keyword)) : shops;
    const start = (query.page - 1) * query.pageSize;
    return {
      list: filtered.slice(start, start + query.pageSize).map((item) => this.shopAccess.toPublic(item)),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async options(actor: AuthUser, tenantId: string | null, platform?: PlatformCode) {
    const shops = await this.shopAccess.listAccessibleShops(actor, tenantId, {
      platform,
      enabledOnly: true,
    });
    return shops
      .filter((item) => Boolean(item.encryptedSecret))
      .map((item) => this.shopAccess.toPublic(item));
  }

  async create(actor: AuthUser, _workingTenantId: string | null, dto: CreateShopDto) {
    this.assertCanManageShops(actor);
    const tenant = await this.requireActiveTenant(dto.tenantId);
    const encryptedSecret = dto.apiToken ? encryptSecret(dto.apiToken) : null;
    try {
      const shop = await this.prisma.platformAccount.create({
        data: {
          tenantId: tenant.id,
          platform: dto.platform,
          name: dto.name.trim(),
          encryptedSecret,
          status: encryptedSecret ? 'ENABLED' : 'PLACEHOLDER',
          extra: this.mergeShopExtra({}, dto.wbBrand) as Prisma.InputJsonValue,
        },
      });
      return this.shopAccess.toPublic(shop);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(actor: AuthUser, _workingTenantId: string | null, id: string, dto: UpdateShopDto) {
    this.assertCanManageShops(actor);
    const shop = await this.requireShopById(id);
    const data: {
      name?: string;
      encryptedSecret?: string;
      status?: PlatformAccountStatus;
      extra?: Prisma.InputJsonValue;
    } = {};
    if (dto.name) {
      data.name = dto.name.trim();
    }
    if (dto.apiToken) {
      data.encryptedSecret = encryptSecret(dto.apiToken);
      if (shop.status !== 'DISABLED') {
        data.status = 'ENABLED';
      }
    }
    if (dto.wbBrand !== undefined) {
      data.extra = this.mergeShopExtra(shop.extra, dto.wbBrand) as Prisma.InputJsonValue;
    }
    try {
      const updated = await this.prisma.platformAccount.update({ where: { id: shop.id }, data });
      return this.shopAccess.toPublic(updated);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async changeStatus(actor: AuthUser, _workingTenantId: string | null, id: string, status: 'ENABLED' | 'DISABLED') {
    this.assertCanManageShops(actor);
    const shop = await this.requireShopById(id);
    if (status === 'ENABLED' && !shop.encryptedSecret) {
      throw new BadRequestException('请先保存店铺 API Token 再启用');
    }
    const updated = await this.prisma.platformAccount.update({
      where: { id: shop.id },
      data: { status },
    });
    return this.shopAccess.toPublic(updated);
  }

  private assertCanManageShops(actor: AuthUser) {
    if (!canManageTenantShops(actor.roles)) {
      throw new ForbiddenException('仅超级管理员可为租户开通或修改店铺，避免占用额度自行换绑');
    }
  }

  private async requireActiveTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('租户不存在');
    }
    if (tenant.status !== 'ACTIVE') {
      throw new BadRequestException('租户已停用，无法开通店铺');
    }
    return tenant;
  }

  private async requireShopById(id: string) {
    const shop = await this.prisma.platformAccount.findUnique({ where: { id } });
    if (!shop) {
      throw new NotFoundException('店铺不存在');
    }
    return shop;
  }

  private mergeShopExtra(value: unknown, wbBrand?: string): Record<string, unknown> {
    const extra =
      value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
    if (wbBrand !== undefined) {
      const brand = wbBrand.trim();
      if (brand) {
        extra.brand = brand;
      } else {
        delete extra.brand;
      }
    }
    return extra;
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException('同平台下店铺名称已存在');
    }
    throw error;
  }
}
