import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { RequirePermissions, SkipTransform } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { AuthUser } from '../auth/auth.types';
import { CrawlerService } from './crawler.service';
import { CreateCategoryTaskDto } from './dto/create-category-task.dto';
import { CreateUrlTaskDto } from './dto/create-url-task.dto';
import { collectFiltersFromDto } from './dto/collect-filters.dto';
import { CrawlerItemQueryDto, CrawlerTaskQueryDto } from './dto/crawler-task-query.dto';

const CSV_MIME = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream']);

function crawlerCsvUploadDir(): string {
  const root = process.env.UPLOAD_ROOT || join(process.cwd(), '../../uploads');
  return join(root, 'crawler-csv');
}

@Controller('crawler/tasks')
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Get()
  @RequirePermissions('crawler:task:list')
  page(@CurrentTenantId() tenantId: string | null, @Query() query: CrawlerTaskQueryDto) {
    return this.crawlerService.page(tenantId, query);
  }

  @Post('category')
  @RequirePermissions('crawler:task:create')
  createCategory(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: CreateCategoryTaskDto,
  ) {
    return this.crawlerService.createCategoryTask(tenantId, user.id, {
      ...dto,
      config: {
        proxies: dto.proxy ? dto.proxy.split(',').map((item) => item.trim()).filter(Boolean) : [],
        crawlAllSkus: dto.crawlAllSkus === true,
        ...collectFiltersFromDto(dto),
      },
    });
  }

  @Post('urls')
  @RequirePermissions('crawler:task:create')
  createUrls(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: CreateUrlTaskDto,
  ) {
    return this.crawlerService.createUrlTask(tenantId, user.id, {
      name: dto.name,
      urls: dto.urls,
      config: {
        proxies: dto.proxy ? dto.proxy.split(',').map((item) => item.trim()).filter(Boolean) : [],
        crawlAllSkus: dto.crawlAllSkus === true,
        ...collectFiltersFromDto(dto),
      },
    });
  }

  @Get(':id')
  @RequirePermissions('crawler:task:list')
  detail(@CurrentTenantId() tenantId: string | null, @Param('id') id: string) {
    return this.crawlerService.detail(tenantId, id);
  }

  @Get(':id/items')
  @RequirePermissions('crawler:task:list')
  items(
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Query() query: CrawlerItemQueryDto,
  ) {
    return this.crawlerService.pageItems(tenantId, id, query);
  }

  @Get(':id/export')
  @RequirePermissions('crawler:task:export')
  @SkipTransform()
  async export(
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const csv = await this.crawlerService.exportCsv(tenantId, id);
    return new StreamableFile(Buffer.from('\uFEFF' + csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="crawler-${id}.csv"`,
    });
  }

  @Post('csv')
  @RequirePermissions('crawler:task:create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = crawlerCsvUploadDir();
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, _file, cb) => {
          cb(null, `${Date.now()}-${randomBytes(8).toString('hex')}.csv`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const nameOk = file.originalname.toLowerCase().endsWith('.csv');
        const mimeOk = !file.mimetype || CSV_MIME.has(file.mimetype);
        if (!nameOk || !mimeOk) {
          cb(new BadRequestException('仅支持 CSV 文件'), false);
          return;
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  createCsv(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      name?: string;
      proxy?: string;
      crawlAllSkus?: string | boolean;
      minRating?: string;
      minReviewCount?: string;
      minSalesCount?: string;
      minPrice?: string;
      maxPrice?: string;
      inStockOnly?: string | boolean;
    },
  ) {
    if (!file) {
      throw new BadRequestException('请上传 CSV 文件');
    }
    return this.crawlerService.createCsvTask(tenantId, user.id, {
      name: body.name || file.originalname.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').slice(0, 120),
      originalName: file.originalname.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').slice(0, 180),
      storagePath: file.path,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: user.id,
      config: {
        proxies: body.proxy ? body.proxy.split(',').map((item) => item.trim()).filter(Boolean) : [],
        crawlAllSkus: body.crawlAllSkus === true || body.crawlAllSkus === 'true',
        minRating: body.minRating,
        minReviewCount: body.minReviewCount,
        minSalesCount: body.minSalesCount,
        minPrice: body.minPrice,
        maxPrice: body.maxPrice,
        inStockOnly: body.inStockOnly === true || body.inStockOnly === 'true',
      } as Record<string, unknown>,
    });
  }

  @Post(':id/retry-failed')
  @RequirePermissions('crawler:task:retry')
  retryFailed(@CurrentTenantId() tenantId: string | null, @Param('id') id: string) {
    return this.crawlerService.retryFailed(tenantId, id);
  }

  @Post('items/:itemId/retry')
  @RequirePermissions('crawler:task:retry')
  retryItem(@CurrentTenantId() tenantId: string | null, @Param('itemId') itemId: string) {
    return this.crawlerService.retryItem(tenantId, itemId);
  }
}
