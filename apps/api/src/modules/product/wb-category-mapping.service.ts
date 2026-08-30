import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WbCategoryMapSource } from '@prisma/client';
import { normalizeOzonCategoryKey } from '@aiecom/platform-core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { ShopAccessService } from '../../common/shop/shop-access.service';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { AuthUser } from '../auth/auth.types';
import { WbListingAdapterFactory } from './wb-listing-adapter.factory';

export type WbCategoryHint = {
  subject: { subjectID: number; subjectName: string };
  sized: boolean | null;
};

export type UpsertWbCategoryMappingInput = {
  ozonCategoryPath: string;
  wbSubjectId: number;
  wbSubjectName: string;
  sized?: boolean | null;
  remark?: string | null;
};

/**
 * Ozon 面包屑 ↔ Wildberries 类目映射。
 *
 * 存在两个作用：
 * 1. 上架时跳过 WB 类目检索（一次检索最多 32 个 GET，是批量上架的主要耗时）；
 * 2. 沉淀「该类目是否按尺码建卡」的结论 —— WB 接口并不返回这个标记，
 *    只能靠人工确认或拒卡文案自学习，学到后同类目商品不再踩同一个坑。
 */
@Injectable()
export class WbCategoryMappingService {
  private readonly logger = new Logger(WbCategoryMappingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
    private readonly adapters: WbListingAdapterFactory,
  ) {}

  async page(
    tenantId: string | null,
    query: PageQueryDto & { keyword?: string; unmappedOnly?: boolean },
  ): Promise<PageResult<unknown>> {
    const tid = requireTenantId(tenantId);
    const keyword = query.keyword?.trim();
    const where: Prisma.WbCategoryMappingWhereInput = {
      tenantId: tid,
      ...(keyword
        ? {
            OR: [
              { ozonCategoryPath: { contains: keyword, mode: 'insensitive' } },
              { wbSubjectName: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.wbCategoryMapping.findMany({
        where,
        orderBy: [{ hitCount: 'desc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.wbCategoryMapping.count({ where }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  /** 商品库里出现过的 Ozon 类目 + 是否已映射，供运营优先补齐高频未映射类目 */
  async ozonCategories(tenantId: string | null): Promise<
    Array<{ ozonCategoryPath: string; productCount: number; mapped: boolean; wbSubjectName: string | null }>
  > {
    const tid = requireTenantId(tenantId);
    const grouped = await this.prisma.product.groupBy({
      by: ['categoryPath'],
      where: { tenantId: tid, categoryPath: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { categoryPath: 'desc' } },
      take: 300,
    });
    const mappings = await this.prisma.wbCategoryMapping.findMany({ where: { tenantId: tid } });
    const byKey = new Map(mappings.map((item) => [item.ozonCategoryKey, item]));
    return grouped
      .filter((item) => item.categoryPath)
      .map((item) => {
        const path = String(item.categoryPath);
        const hit = byKey.get(normalizeOzonCategoryKey(path));
        return {
          ozonCategoryPath: path,
          productCount: item._count._all,
          mapped: Boolean(hit),
          wbSubjectName: hit?.wbSubjectName ?? null,
        };
      });
  }

  /** 只读查询，给上架弹窗回填已维护的映射，不累加命中次数 */
  async findByPath(tenantId: string | null, categoryPath?: string | null) {
    const tid = requireTenantId(tenantId);
    const key = normalizeOzonCategoryKey(categoryPath);
    if (!key) {
      return null;
    }
    return this.prisma.wbCategoryMapping.findUnique({
      where: { tenantId_ozonCategoryKey: { tenantId: tid, ozonCategoryKey: key } },
    });
  }

  /** 上架前查映射；命中则顺带累加命中次数 */
  async resolve(tenantId: string, categoryPath?: string | null): Promise<WbCategoryHint | null> {
    const key = normalizeOzonCategoryKey(categoryPath);
    if (!key) {
      return null;
    }
    const mapping = await this.prisma.wbCategoryMapping.findUnique({
      where: { tenantId_ozonCategoryKey: { tenantId, ozonCategoryKey: key } },
    });
    if (!mapping) {
      return null;
    }
    await this.prisma.wbCategoryMapping
      .update({
        where: { id: mapping.id },
        data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
      })
      .catch(() => undefined);
    return {
      subject: { subjectID: mapping.wbSubjectId, subjectName: mapping.wbSubjectName },
      sized: mapping.sized,
    };
  }

  /**
   * 上架成功后回写检索结果与实际使用的尺码口径。
   * 已存在 MANUAL 映射时不覆盖类目（人工结论优先），但仍可补齐 sized。
   */
  async remember(input: {
    tenantId: string;
    categoryPath?: string | null;
    subjectId?: number;
    subjectName?: string;
    sized?: boolean;
    learned?: boolean;
  }): Promise<void> {
    const key = normalizeOzonCategoryKey(input.categoryPath);
    if (!key || !input.subjectId || !input.subjectName) {
      return;
    }
    const source: WbCategoryMapSource = input.learned ? 'LEARNED' : 'AUTO';
    try {
      const existing = await this.prisma.wbCategoryMapping.findUnique({
        where: { tenantId_ozonCategoryKey: { tenantId: input.tenantId, ozonCategoryKey: key } },
      });
      if (!existing) {
        await this.prisma.wbCategoryMapping.create({
          data: {
            tenantId: input.tenantId,
            ozonCategoryKey: key,
            ozonCategoryPath: String(input.categoryPath),
            wbSubjectId: input.subjectId,
            wbSubjectName: input.subjectName,
            sized: input.sized ?? null,
            source,
            hitCount: 1,
            lastUsedAt: new Date(),
            lastError: null,
          },
        });
        return;
      }
      const keepSubject = existing.source === 'MANUAL';
      await this.prisma.wbCategoryMapping.update({
        where: { id: existing.id },
        data: {
          ...(keepSubject ? {} : { wbSubjectId: input.subjectId, wbSubjectName: input.subjectName }),
          ...(input.sized == null ? {} : { sized: input.sized }),
          ...(keepSubject || (existing.source === 'LEARNED' && !input.learned) ? {} : { source }),
          lastUsedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      // 映射表是加速手段，写失败不能影响上架主流程
      this.logger.warn(`remember category mapping failed key=${key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** 上架失败时记下原因，映射页可直接看到哪些类目仍需人工指定 */
  async recordFailure(tenantId: string, categoryPath: string | null | undefined, message: string): Promise<void> {
    const key = normalizeOzonCategoryKey(categoryPath);
    if (!key) {
      return;
    }
    await this.prisma.wbCategoryMapping
      .updateMany({
        where: { tenantId, ozonCategoryKey: key },
        data: { lastError: message.slice(0, 500) },
      })
      .catch(() => undefined);
  }

  async upsert(tenantId: string | null, input: UpsertWbCategoryMappingInput) {
    const tid = requireTenantId(tenantId);
    const path = String(input.ozonCategoryPath || '').trim();
    const key = normalizeOzonCategoryKey(path);
    if (!key) {
      throw new BadRequestException('请填写 Ozon 类目路径');
    }
    if (!Number.isFinite(input.wbSubjectId) || input.wbSubjectId <= 0) {
      throw new BadRequestException('请选择有效的 WB 类目');
    }
    const data = {
      ozonCategoryPath: path,
      wbSubjectId: Math.floor(input.wbSubjectId),
      wbSubjectName: String(input.wbSubjectName || '').trim() || `subject-${input.wbSubjectId}`,
      remark: input.remark ?? null,
      source: 'MANUAL' as WbCategoryMapSource,
      lastError: null,
      ...(input.sized === undefined ? {} : { sized: input.sized }),
    };
    return this.prisma.wbCategoryMapping.upsert({
      where: { tenantId_ozonCategoryKey: { tenantId: tid, ozonCategoryKey: key } },
      update: data,
      create: { tenantId: tid, ozonCategoryKey: key, sized: input.sized ?? null, ...data },
    });
  }

  async remove(tenantId: string | null, ids: string[]): Promise<{ count: number }> {
    const tid = requireTenantId(tenantId);
    const unique = [...new Set(ids.map((item) => String(item || '').trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('请选择要删除的映射');
    }
    const result = await this.prisma.wbCategoryMapping.deleteMany({
      where: { tenantId: tid, id: { in: unique } },
    });
    if (!result.count) {
      throw new NotFoundException('映射不存在或无权访问');
    }
    return { count: result.count };
  }

  /** 借店铺 Token 调 WB 类目检索，给运营列出候选类目 */
  async suggest(
    actor: AuthUser,
    tenantId: string | null,
    input: { shopId: string; ozonCategoryPath?: string; keyword?: string; productName?: string },
  ) {
    const tid = requireTenantId(tenantId);
    const [shop] = await this.shopAccess.assertShopsAccessible(actor, tid, [input.shopId], {
      platform: 'WILDBERRIES',
      requireEnabledToken: true,
    });
    const subjects = await this.adapters.create(shop).suggestSubjects({
      categoryPath: input.ozonCategoryPath,
      name: input.productName,
      keyword: input.keyword,
    });
    return subjects.slice(0, 60).map((item) => ({
      subjectId: item.subjectID,
      subjectName: item.subjectName,
      parentName: item.parentName ?? null,
    }));
  }
}
