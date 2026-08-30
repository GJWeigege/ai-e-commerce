import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CaptchaDetectedError,
  CollectFailedError,
  CollectorConfig,
  mergeCollectorConfig,
  collectFilterMismatch,
  listingHarvestLimit,
  POLL_STUCK_MS,
  listingQuotaDeficit,
  nextListingBackfill,
  splitListingQueue,
  parseProductUrlsFromCsv,
  retryBackoffMs,
  mergeVariants,
  applyOzonListingFilters,
  buildOzonCategoryListingUrl,
  isOzonListingUrl,
  filterOzonCollectUrls,
  toAllowedCollectUrl,
  isSafeHttpsUrl,
} from '@aiecom/collector-core';
import { CollectorType, CrawlerItemStatus, OzonFulfillment, Prisma } from '@prisma/client';
import { combineFamilyListings, dedupeVariants, fillSkuOptionsFromVariants, isSameOzonFamily, familySkuIds, keepMainSkuOnly, ProductSkuOption, ProductVariant, StandardProduct } from '@aiecom/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/dto/page-query.dto';
import { QUEUE_AI_SELECTION, QUEUE_CRAWLER_PREPARE, QUEUE_CRAWLER_RETRY } from '../../queues/queue.constants';
import { assertAgentCanWriteItem, canCancelCrawlerTask, canDeleteCrawlerTask, CLAIMABLE_TASK_STATUSES, OPEN_ITEM_STATUSES, sanitizeTaskForClient, shouldPreserveTaskStatus } from './crawler-security';

const CHROME_COLLECTOR: CollectorType = 'CHROME_EXT';

export type CreateCategoryTaskInput = {
  name: string;
  categoryId?: string;
  categoryName?: string;
  topN: number;
  config?: Partial<CollectorConfig>;
};

export type CreateCsvTaskInput = {
  name: string;
  originalName: string;
  storagePath: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedById: string;
  config?: Partial<CollectorConfig> | Record<string, unknown>;
};

export type CreateUrlTaskInput = {
  name: string;
  urls: string[];
  config?: Partial<CollectorConfig> & { urls?: string[] };
};

@Injectable()
export class CrawlerService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_CRAWLER_PREPARE) private readonly prepareQueue: Queue,
    @InjectQueue(QUEUE_CRAWLER_RETRY) private readonly retryQueue: Queue,
    @InjectQueue(QUEUE_AI_SELECTION) private readonly aiQueue: Queue,
  ) {}

  async createCategoryTask(tenantId: string | null, userId: string, input: CreateCategoryTaskInput) {
    const tid = requireTenantId(tenantId);
    if (!input.categoryId && !input.categoryName) {
      throw new BadRequestException('请填写品类 ID 或品类名称');
    }
    const config = mergeCollectorConfig(input.config as Record<string, unknown>);
    const task = await this.prisma.crawlerTask.create({
      data: {
        tenantId: tid,
        createdById: userId,
        name: input.name,
        mode: 'CATEGORY_TOP',
        collectorType: CHROME_COLLECTOR,
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        topN: input.topN,
        status: 'QUEUED',
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
    const job = await this.prepareQueue.add(
      'prepare',
      { taskId: task.id, tenantId: tid },
      { attempts: 1 },
    );
    await this.prisma.crawlerTask.update({ where: { id: task.id }, data: { bullJobId: String(job.id) } });
    await this.writeLog(tid, task.id, null, 'INFO', 'create', '已创建品类采集任务并入队');
    return task;
  }

  async createCsvTask(tenantId: string | null, userId: string, input: CreateCsvTaskInput) {
    const tid = requireTenantId(tenantId);
    const config = mergeCollectorConfig(input.config as Record<string, unknown>);
    const file = await this.prisma.fileObject.create({
      data: {
        tenantId: tid,
        bizType: 'CRAWLER_CSV',
        originalName: input.originalName,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: userId,
      },
    });
    const task = await this.prisma.crawlerTask.create({
      data: {
        tenantId: tid,
        createdById: userId,
        name: input.name,
        mode: 'CSV_URL',
        collectorType: CHROME_COLLECTOR,
        csvFileId: file.id,
        status: 'QUEUED',
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
    const job = await this.prepareQueue.add(
      'prepare',
      { taskId: task.id, tenantId: tid },
      { attempts: 1 },
    );
    await this.prisma.crawlerTask.update({ where: { id: task.id }, data: { bullJobId: String(job.id) } });
    await this.writeLog(tid, task.id, null, 'INFO', 'create', `已创建 CSV 采集任务，文件 ${input.originalName}`);
    return task;
  }

  async createUrlTask(tenantId: string | null, userId: string, input: CreateUrlTaskInput) {
    const tid = requireTenantId(tenantId);
    const urls = filterOzonCollectUrls(input.urls);
    if (urls.length === 0) {
      throw new BadRequestException('请提供至少一个 ozon.ru 商品或品类链接');
    }
    const config = {
      ...mergeCollectorConfig(input.config as Record<string, unknown>),
      urls,
    };
    const task = await this.prisma.crawlerTask.create({
      data: {
        tenantId: tid,
        createdById: userId,
        name: input.name,
        mode: 'CSV_URL',
        collectorType: CHROME_COLLECTOR,
        status: 'QUEUED',
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
    const job = await this.prepareQueue.add(
      'prepare',
      { taskId: task.id, tenantId: tid },
      { attempts: 1 },
    );
    await this.prisma.crawlerTask.update({ where: { id: task.id }, data: { bullJobId: String(job.id) } });
    await this.writeLog(tid, task.id, null, 'INFO', 'create', `已创建 ${urls.length} 条商品链接采集任务`);
    return task;
  }

  async ingestDirect(
    tenantId: string | null,
    userId: string,
    product: StandardProduct,
    options?: { crawlAllSkus?: boolean },
  ) {
    const tid = requireTenantId(tenantId);
    const sourceUrl = toAllowedCollectUrl(product.sourceUrl);
    if (!product.skuId || !product.name || !sourceUrl) {
      throw new BadRequestException('商品 skuId / name / sourceUrl 不能为空，且必须是 ozon.ru 链接');
    }
    product.sourceUrl = sourceUrl;
    const task = await this.prisma.crawlerTask.create({
      data: {
        tenantId: tid,
        createdById: userId,
        name: `插件采集 ${product.skuId}`,
        mode: 'CSV_URL',
        collectorType: 'CHROME_EXT',
        status: 'RUNNING',
        totalCount: 1,
        config: {
          urls: [product.sourceUrl],
          crawlAllSkus: options?.crawlAllSkus === true,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    const item = await this.prisma.crawlerTaskItem.create({
      data: {
        tenantId: tid,
        taskId: task.id,
        sourceUrl: product.sourceUrl,
        status: 'RUNNING',
      },
    });
    await this.ingestSuccess(item.id, tid, product);
    return { taskId: task.id, itemId: item.id, skuId: product.skuId };
  }

  async page(
    tenantId: string | null,
    query: PageQueryDto & { status?: string; keyword?: string },
  ): Promise<PageResult<unknown>> {
    const tid = requireTenantId(tenantId);
    const { page, pageSize } = normalizePageQuery(query);
    const where: Prisma.CrawlerTaskWhereInput = {
      tenantId: tid,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.keyword ? { name: { contains: query.keyword, mode: 'insensitive' } } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.crawlerTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { csvFile: { select: { originalName: true } } },
      }),
      this.prisma.crawlerTask.count({ where }),
    ]);
    return { list: list.map((row) => sanitizeTaskForClient(row)), total, page, pageSize };
  }

  async detail(tenantId: string | null, taskId: string) {
    const tid = requireTenantId(tenantId);
    const task = await this.prisma.crawlerTask.findFirst({
      where: { id: taskId, tenantId: tid },
      include: {
        items: { where: productItemWhere(), orderBy: { createdAt: 'asc' }, take: 200 },
        logs: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!task) {
      throw new NotFoundException('采集任务不存在');
    }
    return sanitizeTaskForClient(task);
  }

  async pageItems(
    tenantId: string | null,
    taskId: string,
    query: PageQueryDto & { status?: string },
  ) {
    const tid = requireTenantId(tenantId);
    await this.ensureTask(tid, taskId);
    const { page, pageSize } = normalizePageQuery(query);
    if (await this.purgeExpandedListingItems(taskId, tid)) {
      await this.refreshTaskStatus(taskId, tid);
    }
    const where: Prisma.CrawlerTaskItemWhereInput = {
      tenantId: tid,
      taskId,
      ...productItemWhere(),
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.crawlerTaskItem.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { snapshot: true },
      }),
      this.prisma.crawlerTaskItem.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async retryItem(tenantId: string | null, itemId: string) {
    const tid = requireTenantId(tenantId);
    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: { id: itemId, tenantId: tid },
      include: { task: true },
    });
    if (!item) {
      throw new NotFoundException('采集条目不存在');
    }
    if (item.status !== 'FAILED') {
      throw new BadRequestException('仅失败条目可重试');
    }
    if (shouldPreserveTaskStatus(item.task.status)) {
      throw new BadRequestException('任务已作废或暂停，不能再重试');
    }
    await this.enqueueRetry(item.id, tid, 0);
    await this.writeLog(tid, item.taskId, item.id, 'INFO', 'retry', '单条重试已入队');
    return { ok: true };
  }

  async retryFailed(tenantId: string | null, taskId: string) {
    const tid = requireTenantId(tenantId);
    const task = await this.ensureTask(tid, taskId);
    if (shouldPreserveTaskStatus(task.status)) {
      throw new BadRequestException('任务已作废或暂停，不能再重试');
    }
    const items = await this.prisma.crawlerTaskItem.findMany({
      where: { tenantId: tid, taskId, status: 'FAILED' },
    });
    for (const item of items) {
      await this.enqueueRetry(item.id, tid, 0);
    }
    await this.writeLog(tid, taskId, null, 'INFO', 'retry', `批量重试 ${items.length} 条`);
    return { count: items.length };
  }

  async cancelTask(tenantId: string | null, taskId: string) {
    const tid = requireTenantId(tenantId);
    const task = await this.ensureTask(tid, taskId);
    if (!canCancelCrawlerTask(task.status)) {
      throw new BadRequestException('当前状态不能作废，已结束的任务请直接删除');
    }
    await this.prisma.crawlerTaskItem.updateMany({
      where: { tenantId: tid, taskId, status: { in: [...OPEN_ITEM_STATUSES] } },
      data: {
        status: 'SKIPPED',
        assignedAgentId: null,
        failCode: 'TASK_CANCELLED',
        failReason: '任务已作废',
      },
    });
    const updated = await this.prisma.crawlerTask.update({
      where: { id: taskId },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        errorMessage: '已作废，插件不再领取该任务',
      },
    });
    await this.writeLog(tid, taskId, null, 'WARN', 'cancel', '任务已作废，剩余条目不再领取');
    await this.refreshTaskStatus(taskId, tid);
    const latest = await this.prisma.crawlerTask.findFirst({ where: { id: taskId, tenantId: tid } });
    return sanitizeTaskForClient(latest ?? updated);
  }

  async deleteTask(tenantId: string | null, taskId: string) {
    const tid = requireTenantId(tenantId);
    const task = await this.ensureTask(tid, taskId);
    if (!canDeleteCrawlerTask(task.status)) {
      throw new BadRequestException('请先作废进行中的任务，再删除');
    }
    await this.prisma.crawlerTask.delete({ where: { id: taskId } });
    return { ok: true };
  }

  async exportCsv(tenantId: string | null, taskId: string): Promise<string> {
    const tid = requireTenantId(tenantId);
    const items = await this.prisma.crawlerTaskItem.findMany({
      where: { tenantId: tid, taskId, ...productItemWhere() },
      include: { snapshot: true },
      orderBy: { createdAt: 'asc' },
    });
    const header = 'sku_id,name,url,price,currency,stock,rating,sales,status,failReason';
    const rows = items.map((item) => {
      const snap = item.snapshot;
      return [
        snap?.skuId ?? item.skuId ?? '',
        csvCell(snap?.name ?? ''),
        item.sourceUrl,
        snap?.price?.toString() ?? '',
        snap?.currency ?? '',
        snap?.stock ?? '',
        snap?.rating?.toString() ?? '',
        snap?.salesCount ?? '',
        item.status,
        csvCell(item.failReason ?? ''),
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  async prepareTask(taskId: string, tenantId: string) {
    const task = await this.ensureTask(tenantId, taskId);
    await this.prisma.crawlerTask.update({
      where: { id: taskId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const rawConfig = (task.config as Record<string, unknown> | null) ?? {};
    const config = mergeCollectorConfig(rawConfig);
    try {
      let urls: string[] = [];
      const configUrls = Array.isArray(rawConfig.urls)
        ? filterOzonCollectUrls((rawConfig.urls as unknown[]).map((item) => String(item)))
        : [];

      if (configUrls.length > 0) {
        urls = configUrls;
      } else if (task.mode === 'CATEGORY_TOP') {
        const listingUrl = applyOzonListingFilters(
          buildOzonCategoryListingUrl({
            categoryId: task.categoryId ?? undefined,
            categoryName: task.categoryName ?? undefined,
          }),
          config,
        );
        await this.prisma.crawlerTaskItem.upsert({
          where: { taskId_sourceUrl: { taskId, sourceUrl: listingUrl } },
          update: { status: 'PENDING', failReason: null, failCode: null },
          create: {
            tenantId,
            taskId,
            sourceUrl: listingUrl,
            status: 'PENDING',
            maxRetry: config.maxRetry,
          },
        });
        await this.writeLog(tenantId, taskId, null, 'INFO', 'prepare', `已下发品类页给 Chrome 插件：${listingUrl}`);
        await this.refreshTaskStatus(taskId, tenantId);
        return;
      } else {
        if (!task.csvFileId) {
          throw new BadRequestException('CSV 任务缺少文件或商品链接');
        }
        const file = await this.prisma.fileObject.findFirst({ where: { id: task.csvFileId, tenantId } });
        if (!file) {
          throw new NotFoundException('CSV 文件不存在');
        }
        const fs = await import('fs/promises');
        const content = await fs.readFile(file.storagePath, 'utf8');
        urls = parseProductUrlsFromCsv(content);
      }

      urls = urls.filter((url) => !/\/product\/mock-/i.test(url));

      if (urls.length === 0) {
        await this.failTask(taskId, tenantId, '未解析到任何真实商品 URL');
        return;
      }

      const stillRunning = await this.prisma.crawlerTask.findFirst({ where: { id: taskId, tenantId, status: 'RUNNING' } });
      if (!stillRunning) {
        return;
      }

      await this.prisma.crawlerTask.update({ where: { id: taskId }, data: { totalCount: urls.length } });

      for (const url of urls) {
        await this.prisma.crawlerTaskItem.upsert({
          where: { taskId_sourceUrl: { taskId, sourceUrl: url } },
          update: { status: 'PENDING', failReason: null, failCode: null },
          create: {
            tenantId,
            taskId,
            sourceUrl: url,
            status: 'PENDING',
            maxRetry: config.maxRetry,
          },
        });
      }

      await this.writeLog(tenantId, taskId, null, 'INFO', 'prepare', `已生成 ${urls.length} 条采集明细，等待 Chrome 插件领取`);
      await this.refreshTaskStatus(taskId, tenantId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failTask(taskId, tenantId, message);
    }
  }

  async failTask(taskId: string, tenantId: string, errorMessage: string) {
    await this.prisma.crawlerTask.updateMany({
      where: { id: taskId, tenantId, status: { not: 'CANCELLED' } },
      data: { status: 'FAILED', errorMessage, finishedAt: new Date() },
    });
    await this.writeLog(tenantId, taskId, null, 'ERROR', 'prepare', errorMessage);
  }

  /** 将条目放回 PENDING，由用户浏览器里的 Chrome 插件领取，服务端不再打开页面爬取 */
  async releaseItemToAgent(itemId: string, tenantId: string) {
    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: { id: itemId, tenantId },
      include: { task: true },
    });
    if (!item) {
      return;
    }
    if (item.status === 'SUCCESS' || shouldPreserveTaskStatus(item.task.status)) {
      return;
    }
    await this.prisma.crawlerTaskItem.update({
      where: { id: itemId },
      data: {
        status: 'PENDING',
        assignedAgentId: null,
        failReason: null,
        failCode: null,
      },
    });
    await this.writeLog(tenantId, item.taskId, itemId, 'INFO', 'retry', '已重新放入 Chrome 插件领取队列');
    await this.refreshTaskStatus(item.taskId, tenantId);
  }

  async ingestSuccess(
    itemId: string,
    tenantId: string,
    product: StandardProduct,
    options?: { agentKey?: string },
  ) {
    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: { id: itemId, tenantId },
      include: { task: true },
    });
    if (!item) {
      throw new NotFoundException('采集条目不存在');
    }
    if (shouldPreserveTaskStatus(item.task.status)) {
      throw new BadRequestException('任务已作废或暂停，停止回写');
    }
    if (options?.agentKey) {
      const agent = await this.prisma.collectorAgent.findUnique({
        where: { tenantId_agentKey: { tenantId, agentKey: options.agentKey } },
      });
      if (!agent) {
        throw new BadRequestException('采集端未注册，请先心跳');
      }
      assertAgentCanWriteItem(item, agent.id);
    } else if (item.status !== 'RUNNING') {
      throw new BadRequestException('当前条目不可回写（未领取或已结束）');
    }

    const sourceUrl = toAllowedCollectUrl(product.sourceUrl);
    if (!sourceUrl) {
      throw new BadRequestException('商品链接必须是 ozon.ru 商品页');
    }
    product.sourceUrl = sourceUrl;
    product.mainImageUrl = product.mainImageUrl && isSafeHttpsUrl(product.mainImageUrl) ? product.mainImageUrl : undefined;
    product.imageUrls = (product.imageUrls ?? []).filter(isSafeHttpsUrl);
    product.videoUrls = (product.videoUrls ?? []).filter(isSafeHttpsUrl);

    const config = mergeCollectorConfig(item.task.config as Record<string, unknown> | null);
    const mismatch = collectFilterMismatch(product, config);
    if (mismatch) {
      await this.prisma.crawlerTaskItem.update({
        where: { id: itemId },
        data: {
          status: 'SKIPPED',
          skuId: product.skuId,
          crawledAt: new Date(),
          failCode: 'FILTER_MISMATCH',
          failReason: mismatch,
        },
      });
      await this.writeLog(tenantId, item.taskId, itemId, 'INFO', 'ingest', `未达采集条件，已跳过 sku=${product.skuId}：${mismatch}`);
      await this.enqueueListingBackfill(item.taskId, tenantId);
      await this.refreshTaskStatus(item.taskId, tenantId);
      return;
    }

    const crawlAllSkus = config.crawlAllSkus;
    product.variants = dedupeVariants(product.variants ?? []);
    if (crawlAllSkus) {
      product.skuOptions = fillSkuOptionsFromVariants(product);
    } else {
      const kept = keepMainSkuOnly(product);
      product.variants = kept.variants;
      product.skuOptions = kept.skuOptions;
    }

    const listingBase = {
      description: product.description,
      brand: product.brand,
      originalPrice: product.originalPrice,
      discountPrice: product.discountPrice,
      reviewCount: product.reviewCount ?? 0,
      videoUrls: product.videoUrls ?? [],
      variants: (product.variants ?? []) as unknown as Prisma.InputJsonValue,
    };
    const listingWithSku = {
      ...listingBase,
      skuOptions: (product.skuOptions ?? []) as unknown as Prisma.InputJsonValue,
    };

    const snapshotData = {
      skuId: product.skuId,
      name: product.name,
      sourceUrl: product.sourceUrl,
      mainImageUrl: product.mainImageUrl,
      imageUrls: product.imageUrls,
      price: product.price,
      currency: product.currency,
      stock: product.stock,
      warehouseType: toFulfillment(product.warehouseType),
      fboStock: product.fboStock ?? null,
      fbsStock: product.fbsStock ?? null,
      specs: product.specs as unknown as Prisma.InputJsonValue,
      categoryPath: product.categoryPath,
      rating: product.rating,
      salesCount: product.salesCount,
      rawPayload: product as unknown as Prisma.InputJsonValue,
    };

    let listing: typeof listingBase & { skuOptions?: Prisma.InputJsonValue } = listingWithSku;
    let wroteSkuOptionsViaClient = true;
    let snapshot: { id: string };
    try {
      snapshot = await this.prisma.productSnapshot.upsert({
        where: { taskItemId: itemId },
        update: { ...snapshotData, ...listing },
        create: { tenantId, taskItemId: itemId, ...snapshotData, ...listing },
      });
    } catch (error) {
      // Prisma Client 未 generate 时会拒绝 skuOptions；库表已有该列，降级写入后再补 SQL
      if (!/Unknown argument `skuOptions`/.test(String(error instanceof Error ? error.message : error))) {
        throw error;
      }
      wroteSkuOptionsViaClient = false;
      listing = listingBase;
      snapshot = await this.prisma.productSnapshot.upsert({
        where: { taskItemId: itemId },
        update: { ...snapshotData, ...listing },
        create: { tenantId, taskItemId: itemId, ...snapshotData, ...listing },
      });
    }

    const existing = await this.prisma.product.findUnique({
      where: { tenantId_skuId: { tenantId, skuId: product.skuId } },
    });

    const { rawPayload, ...productCore } = snapshotData;

    const productRecord = await this.prisma.product.upsert({
      where: { tenantId_skuId: { tenantId, skuId: product.skuId } },
      update: {
        ...productCore,
        ...listing,
        snapshotId: snapshot.id,
        ...(!existing || ['CRAWLED', 'AI_PENDING', 'AI_DONE', 'REVIEW_PENDING', 'REJECTED'].includes(existing.status)
          ? { status: 'APPROVED' as const }
          : {}),
      },
      create: {
        tenantId,
        snapshotId: snapshot.id,
        ...productCore,
        ...listing,
        status: 'APPROVED',
      },
    });

    if (!wroteSkuOptionsViaClient) {
      const json = JSON.stringify(product.skuOptions ?? []);
      await this.prisma.$executeRawUnsafe(`UPDATE "product_snapshots" SET "skuOptions" = $1::jsonb WHERE "id" = $2`, json, snapshot.id);
      await this.prisma.$executeRawUnsafe(`UPDATE "products" SET "skuOptions" = $1::jsonb WHERE "id" = $2`, json, productRecord.id);
    }

    if (crawlAllSkus) {
      await this.mergeFamilyProducts(tenantId, productRecord, product);
    }

    await this.prisma.crawlerTaskItem.update({
      where: { id: itemId },
      data: { status: 'SUCCESS', skuId: product.skuId, crawledAt: new Date(), failReason: null, failCode: null },
    });

    const shouldAi = !existing || ['CRAWLED', 'AI_PENDING', 'AI_DONE', 'REVIEW_PENDING', 'REJECTED'].includes(existing.status);
    if (shouldAi) {
      const existingAi = await this.prisma.aiSelection.findFirst({
        where: { tenantId, productId: productRecord.id },
      });
      const ai = existingAi
        ? await this.prisma.aiSelection.update({
            where: { id: existingAi.id },
            data: { snapshotId: snapshot.id, status: 'QUEUED', errorMessage: null },
          })
        : await this.prisma.aiSelection.create({
            data: { tenantId, snapshotId: snapshot.id, productId: productRecord.id, status: 'QUEUED' },
          });
      await this.aiQueue.add('select', { tenantId, snapshotId: snapshot.id, productId: productRecord.id, aiId: ai.id });
    }

    await this.writeLog(tenantId, item.taskId, itemId, 'INFO', 'ingest', `采集成功 sku=${product.skuId}`);
    await this.refreshTaskStatus(item.taskId, tenantId);
  }

  async ingestFailure(itemId: string, tenantId: string, error: unknown, options?: { agentKey?: string }) {
    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: { id: itemId, tenantId },
      include: { task: true },
    });
    if (!item) return;
    if (shouldPreserveTaskStatus(item.task.status)) {
      return;
    }
    if (options?.agentKey) {
      const agent = await this.prisma.collectorAgent.findUnique({
        where: { tenantId_agentKey: { tenantId, agentKey: options.agentKey } },
      });
      if (!agent) {
        throw new BadRequestException('采集端未注册，请先心跳');
      }
      assertAgentCanWriteItem(item, agent.id);
    }

    const captcha = error instanceof CaptchaDetectedError;
    const code = captcha ? 'CAPTCHA_DETECTED' : error instanceof CollectFailedError ? error.code : 'COLLECT_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    const nextRetry = item.retryCount + 1;
    const canRetry = !captcha && nextRetry <= item.maxRetry;

    await this.prisma.crawlerTaskItem.update({
      where: { id: itemId },
      data: {
        status: canRetry ? 'RETRYING' : 'FAILED',
        retryCount: nextRetry,
        failCode: code,
        failReason: message,
      },
    });
    await this.writeLog(tenantId, item.taskId, itemId, 'ERROR', 'ingest', message, { code, captcha, retryCount: nextRetry });

    if (canRetry) {
      await this.enqueueRetry(itemId, tenantId, retryBackoffMs(item.retryCount));
    } else {
      await this.enqueueListingBackfill(item.taskId, tenantId);
    }
    await this.refreshTaskStatus(item.taskId, tenantId);
  }

  async heartbeat(tenantId: string | null, input: { agentKey: string; type: CollectorType; name: string; sessionValid: boolean; version?: string }) {
    const tid = requireTenantId(tenantId);
    return this.prisma.collectorAgent.upsert({
      where: { tenantId_agentKey: { tenantId: tid, agentKey: input.agentKey } },
      update: {
        name: input.name,
        type: input.type,
        status: 'ONLINE',
        sessionValid: input.sessionValid,
        version: input.version,
        lastHeartbeatAt: new Date(),
      },
      create: {
        tenantId: tid,
        agentKey: input.agentKey,
        name: input.name,
        type: input.type,
        status: 'ONLINE',
        sessionValid: input.sessionValid,
        version: input.version,
        lastHeartbeatAt: new Date(),
      },
    });
  }

  async claimItem(tenantId: string | null, input: { agentKey: string; type: CollectorType }) {
    const tid = requireTenantId(tenantId);
    const agent = await this.prisma.collectorAgent.findUnique({
      where: { tenantId_agentKey: { tenantId: tid, agentKey: input.agentKey } },
    });
    if (!agent) {
      throw new BadRequestException('采集端未注册，请先心跳');
    }

    await this.prisma.crawlerTaskItem.updateMany({
      where: {
        tenantId: tid,
        assignedAgentId: agent.id,
        status: 'RUNNING',
        updatedAt: { lt: new Date(Date.now() - POLL_STUCK_MS) },
        task: { status: { in: [...CLAIMABLE_TASK_STATUSES] } },
      },
      data: { status: 'PENDING', assignedAgentId: null, failReason: null, failCode: null },
    });

    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: {
        tenantId: tid,
        status: 'PENDING',
        task: { collectorType: input.type, status: { in: [...CLAIMABLE_TASK_STATUSES] } },
      },
      include: { task: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!item) {
      return null;
    }

    const updated = await this.prisma.crawlerTaskItem.updateMany({
      where: { id: item.id, tenantId: tid, status: 'PENDING' },
      data: { status: 'RUNNING', assignedAgentId: agent.id },
    });
    if (updated.count === 0) {
      return null;
    }
    await this.prisma.collectorAgent.update({ where: { id: agent.id }, data: { status: 'BUSY', lastHeartbeatAt: new Date() } });
    const claimed = await this.prisma.crawlerTaskItem.findUnique({ where: { id: item.id } });
    const topN = item.task.topN ?? 10;
    return {
      ...claimed,
      crawlAllSkus: mergeCollectorConfig(item.task.config as Record<string, unknown> | null).crawlAllSkus,
      topN,
      listingLimit: listingHarvestLimit(topN), // 按 TOP N 放大候选，过滤后仍能凑满达标条数
    };
  }

  async expandListingFromAgent(
    itemId: string,
    tenantId: string | null,
    input: { agentKey: string; urls: string[] },
  ) {
    const tid = requireTenantId(tenantId);
    const agent = await this.prisma.collectorAgent.findUnique({
      where: { tenantId_agentKey: { tenantId: tid, agentKey: input.agentKey } },
    });
    if (!agent) {
      throw new BadRequestException('采集端未注册，请先心跳');
    }
    const item = await this.prisma.crawlerTaskItem.findFirst({
      where: { id: itemId, tenantId: tid },
      include: { task: true },
    });
    if (!item) {
      throw new NotFoundException('采集条目不存在');
    }
    if (shouldPreserveTaskStatus(item.task.status)) {
      throw new BadRequestException('任务已作废或暂停，停止展开品类页');
    }
    assertAgentCanWriteItem(item, agent.id);
    if (!isOzonListingUrl(item.sourceUrl)) {
      throw new BadRequestException('当前条目不是品类/搜索页，无法展开商品链接');
    }
    const topN = item.task.topN ?? 10;
    const { immediate, pool } = splitListingQueue(input.urls ?? [], topN, item.sourceUrl);
    if (immediate.length === 0) {
      await this.ingestFailure(itemId, tid, new CollectFailedError('EMPTY_SEARCH', '品类页未解析到真实商品链接'));
      return { ok: false, count: 0 };
    }
    const rawConfig = ((item.task.config as Record<string, unknown> | null) ?? {});
    const config = mergeCollectorConfig(rawConfig);
    for (const url of immediate) {
      await this.prisma.crawlerTaskItem.upsert({
        where: { taskId_sourceUrl: { taskId: item.taskId, sourceUrl: url } },
        update: { status: 'PENDING', failReason: null, failCode: null },
        create: {
          tenantId: tid,
          taskId: item.taskId,
          sourceUrl: url,
          status: 'PENDING',
          maxRetry: config.maxRetry,
        },
      });
    }
    await this.prisma.crawlerTask.update({
      where: { id: item.taskId },
      data: { config: { ...rawConfig, listingPool: pool } as Prisma.InputJsonValue },
    });
    await this.prisma.crawlerTaskItem.delete({ where: { id: itemId } });
    const short =
      immediate.length < topN
        ? `，品类页只解析到 ${immediate.length} 条，少于 TOP ${topN}`
        : `，候选池 ${pool.length} 条用于未达条件时补齐`;
    await this.writeLog(tid, item.taskId, null, 'INFO', 'listing', `品类页展开 ${immediate.length} 条商品链接${short}`);
    await this.refreshTaskStatus(item.taskId, tid);
    await this.prisma.collectorAgent.update({
      where: { id: agent.id },
      data: { status: 'ONLINE', lastHeartbeatAt: new Date() },
    });
    return { ok: true, count: immediate.length };
  }

  private async enqueueRetry(itemId: string, tenantId: string, delay: number) {
    await this.retryQueue.add('retry', { itemId, tenantId }, { delay });
    await this.prisma.crawlerTaskItem.update({
      where: { id: itemId },
      data: { status: 'RETRYING' },
    });
  }

  async refreshTaskStatus(taskId: string, tenantId: string) {
    const current = await this.prisma.crawlerTask.findFirst({
      where: { id: taskId, tenantId },
      select: { status: true },
    });
    if (!current) {
      return;
    }
    const items = await this.prisma.crawlerTaskItem.findMany({
      where: { taskId, tenantId },
      select: { status: true, sourceUrl: true, failReason: true },
    });
    const products = items.filter((item) => !isOzonListingUrl(item.sourceUrl));
    const listings = items.filter((item) => isOzonListingUrl(item.sourceUrl));
    const countOf = (rows: typeof items, status: CrawlerItemStatus) => rows.filter((row) => row.status === status).length;
    const successCount = countOf(products, 'SUCCESS');
    const failCount = countOf(products, 'FAILED');
    const pending =
      countOf(products, 'PENDING') +
      countOf(products, 'QUEUED') +
      countOf(products, 'RUNNING') +
      countOf(products, 'RETRYING');
    const total = products.length;

    let status: 'RUNNING' | 'SUCCESS' | 'PARTIAL_FAILED' | 'FAILED' | 'QUEUED' = 'RUNNING';
    let finishedAt: Date | null = null;
    let errorMessage: string | null | undefined;
    if (total === 0) {
      const listingPending = listings.some(
        (item) =>
          item.status === 'PENDING' ||
          item.status === 'QUEUED' ||
          item.status === 'RUNNING' ||
          item.status === 'RETRYING',
      );
      if (listingPending) {
        status = 'RUNNING';
      } else if (listings.some((item) => item.status === 'FAILED')) {
        status = 'FAILED';
        finishedAt = new Date();
        errorMessage = listings.find((item) => item.failReason)?.failReason ?? '品类页展开失败';
      } else {
        status = 'QUEUED';
      }
    } else if (pending === 0) {
      finishedAt = new Date();
      if (failCount === 0) status = 'SUCCESS';
      else if (successCount === 0) status = 'FAILED';
      else status = 'PARTIAL_FAILED';
    }

    await this.prisma.crawlerTask.update({
      where: { id: taskId },
      data: {
        successCount,
        failCount,
        totalCount: total,
        ...(shouldPreserveTaskStatus(current.status)
          ? {}
          : { status, finishedAt, ...(errorMessage !== undefined ? { errorMessage } : {}) }),
      },
    });
  }

  /** 未达条件的商品不计入 TOP N，从品类页候选池再补一条 */
  private async enqueueListingBackfill(taskId: string, tenantId: string): Promise<number> {
    const task = await this.ensureTask(tenantId, taskId);
    if (task.mode !== 'CATEGORY_TOP' || shouldPreserveTaskStatus(task.status)) {
      return 0;
    }
    const topN = task.topN ?? 10;
    const items = await this.prisma.crawlerTaskItem.findMany({
      where: { taskId, tenantId },
      select: { status: true, sourceUrl: true },
    });
    const products = items.filter((row) => !isOzonListingUrl(row.sourceUrl));
    const inFlight = products.filter(
      (row) =>
        row.status === 'PENDING' ||
        row.status === 'QUEUED' ||
        row.status === 'RUNNING' ||
        row.status === 'RETRYING',
    ).length;
    const success = products.filter((row) => row.status === 'SUCCESS').length;
    const need = listingQuotaDeficit(topN, { success, inFlight });
    if (need <= 0) {
      return 0;
    }

    const rawConfig = ((task.config as Record<string, unknown> | null) ?? {});
    const pool = Array.isArray(rawConfig.listingPool) ? (rawConfig.listingPool as unknown[]).map((item) => String(item)) : [];
    const { next, remaining } = nextListingBackfill(
      pool,
      products.map((row) => row.sourceUrl),
      need,
    );
    if (next.length === 0) {
      await this.writeLog(
        tenantId,
        taskId,
        null,
        'WARN',
        'listing',
        `候选池已空，仍缺 ${need} 条达标商品（TOP ${topN}）。品类页已拆完候选，请放宽筛选或换品类后重试`,
      );
      return 0;
    }

    const config = mergeCollectorConfig(rawConfig);
    for (const url of next) {
      await this.prisma.crawlerTaskItem.upsert({
        where: { taskId_sourceUrl: { taskId, sourceUrl: url } },
        update: { status: 'PENDING', failReason: null, failCode: null },
        create: {
          tenantId,
          taskId,
          sourceUrl: url,
          status: 'PENDING',
          maxRetry: config.maxRetry,
        },
      });
    }
    await this.prisma.crawlerTask.update({
      where: { id: taskId },
      data: { config: { ...rawConfig, listingPool: remaining } as Prisma.InputJsonValue },
    });
    await this.writeLog(
      tenantId,
      taskId,
      null,
      'INFO',
      'listing',
      `未达条件已补齐 ${next.length} 条，候选池剩余 ${remaining.length}`,
    );
    return next.length;
  }

  /** 品类页只是展开入口，展开成功后不应再出现在明细和计数里 */
  private async purgeExpandedListingItems(taskId: string, tenantId: string): Promise<boolean> {
    const stale = await this.prisma.crawlerTaskItem.findMany({
      where: { tenantId, taskId, status: 'SUCCESS', skuId: null },
      select: { id: true, sourceUrl: true },
    });
    const ids = stale.filter((row) => isOzonListingUrl(row.sourceUrl)).map((row) => row.id);
    if (!ids.length) {
      return false;
    }
    await this.prisma.crawlerTaskItem.deleteMany({ where: { id: { in: ids }, tenantId } });
    return true;
  }

  private async ensureTask(tenantId: string, taskId: string) {
    const task = await this.prisma.crawlerTask.findFirst({ where: { id: taskId, tenantId } });
    if (!task) {
      throw new NotFoundException('采集任务不存在');
    }
    return task;
  }

  private asSkuOptions(value: unknown): ProductSkuOption[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is ProductSkuOption => Boolean(item) && typeof item === 'object' && typeof (item as ProductSkuOption).skuId === 'string',
    );
  }

  private asVariants(value: unknown): ProductVariant[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is ProductVariant => Boolean(item) && typeof item === 'object' && typeof (item as ProductVariant).name === 'string',
    );
  }

  /** 同一 Ozon 商品族（重量/口味不同 SKU）合并为一条商品，避免 250g / 1kg 各占一行 */
  private async mergeFamilyProducts(
    tenantId: string,
    current: { id: string; skuId: string; name: string; brand: string | null; skuOptions: unknown; variants: unknown; status: string },
    incoming: StandardProduct,
  ) {
    const familyIds = familySkuIds(incoming);
    const asciiHint = String(incoming.name || '').match(/[A-Za-z][A-Za-z0-9]+(?:\s+[A-Za-z][A-Za-z0-9]+)*/)?.[0];
    const or: Prisma.ProductWhereInput[] = [
      ...(familyIds.length ? [{ skuId: { in: familyIds } }] : []),
      ...(asciiHint && asciiHint.length >= 4 ? [{ name: { contains: asciiHint, mode: 'insensitive' as const } }] : []),
    ];
    if (!or.length) {
      return current;
    }
    const candidates = await this.prisma.product.findMany({
      where: {
        tenantId,
        NOT: { id: current.id },
        OR: or,
      },
      take: 80,
    });
    const relatives = candidates.filter((item) =>
      isSameOzonFamily(
        incoming,
        {
          skuId: item.skuId,
          name: item.name,
          sourceUrl: item.sourceUrl,
          brand: item.brand,
          variants: this.asVariants(item.variants),
          skuOptions: this.asSkuOptions(item.skuOptions),
        },
      ),
    );
    if (!relatives.length) {
      return current;
    }
    const combined = combineFamilyListings([
      {
        skuId: incoming.skuId,
        name: incoming.name,
        sourceUrl: incoming.sourceUrl,
        price: incoming.price,
        originalPrice: incoming.originalPrice,
        discountPrice: incoming.discountPrice,
        imageUrls: incoming.imageUrls,
        variants: mergeVariants([this.asVariants(current.variants), incoming.variants ?? []]),
        skuOptions: [...this.asSkuOptions(current.skuOptions), ...(incoming.skuOptions ?? [])],
      },
      ...relatives.map((item) => ({
        skuId: item.skuId,
        name: item.name,
        sourceUrl: item.sourceUrl,
        price: Number(item.price),
        originalPrice: item.originalPrice != null ? Number(item.originalPrice) : undefined,
        discountPrice: item.discountPrice != null ? Number(item.discountPrice) : undefined,
        imageUrls: item.imageUrls ?? [],
        variants: this.asVariants(item.variants),
        skuOptions: this.asSkuOptions(item.skuOptions),
      })),
    ]);
    const skuOptions = combined.skuOptions;
    const variants = combined.variants;
    let updated = current;
    try {
      updated = await this.prisma.product.update({
        where: { id: current.id },
        data: {
          skuOptions: skuOptions as unknown as Prisma.InputJsonValue,
          variants: variants as unknown as Prisma.InputJsonValue,
          ...(relatives.some((item) => item.status === 'ON_SHELF') &&
          ['CRAWLED', 'AI_PENDING', 'AI_DONE', 'REVIEW_PENDING'].includes(current.status)
            ? { status: 'ON_SHELF' as const }
            : {}),
        },
      });
    } catch (error) {
      if (!/Unknown argument `skuOptions`/.test(String(error instanceof Error ? error.message : error))) {
        throw error;
      }
      updated = await this.prisma.product.update({
        where: { id: current.id },
        data: { variants: variants as unknown as Prisma.InputJsonValue },
      });
      await this.prisma.$executeRawUnsafe(
        `UPDATE "products" SET "skuOptions" = $1::jsonb WHERE "id" = $2`,
        JSON.stringify(skuOptions),
        current.id,
      );
    }
    for (const dup of relatives) {
      const orders = await this.prisma.salesOrder.count({ where: { productId: dup.id } });
      if (orders > 0) {
        continue;
      }
      await this.prisma.aiSelection.deleteMany({ where: { productId: dup.id } });
      await this.prisma.productReview.deleteMany({ where: { productId: dup.id } });
      await this.prisma.product.delete({ where: { id: dup.id } });
    }
    return updated;
  }

  async writeLog(
    tenantId: string,
    taskId: string,
    itemId: string | null,
    level: 'INFO' | 'WARN' | 'ERROR',
    stage: string,
    message: string,
    extra?: Record<string, unknown>,
  ) {
    await this.prisma.crawlerLog.create({
      data: {
        tenantId,
        taskId,
        itemId: itemId ?? undefined,
        level,
        stage,
        message,
        extra: extra as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 明细/导出/计数只看真实商品 URL，品类页本身不算采集结果 */
function productItemWhere(): Prisma.CrawlerTaskItemWhereInput {
  return { sourceUrl: { contains: '/product/' } };
}

function toFulfillment(value?: string | null): OzonFulfillment | null {
  const raw = String(value || '').toUpperCase();
  if (raw === 'FBO' || raw === 'FBS' || raw === 'MIXED') {
    return raw;
  }
  return null;
}
