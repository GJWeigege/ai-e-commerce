import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { requireTenantId } from '../../common/tenant/tenant-scope';
import { AuthUser } from '../auth/auth.types';
import { CrawlerService } from './crawler.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { AgentProductDto, AgentResultDto, AgentListingDto, ClaimTaskDto } from './dto/agent-result.dto';
import { StandardProduct } from '@aiecom/shared';

function toStandardProduct(dto: AgentProductDto): StandardProduct {
  const specs = [...(dto.specs ?? [])];
  if (dto.description && !specs.some((item) => item.name === '商品描述')) {
    specs.push({ name: '商品描述', value: dto.description.slice(0, 4000) });
  }
  return {
    skuId: dto.skuId,
    name: dto.name,
    sourceUrl: dto.sourceUrl,
    mainImageUrl: dto.mainImageUrl,
    imageUrls: dto.imageUrls ?? [],
    price: Number(dto.price),
    currency: dto.currency ?? 'RUB',
    stock: Number(dto.stock),
    specs,
    categoryPath: dto.categoryPath,
    rating: dto.rating,
    salesCount: Number(dto.salesCount ?? 0),
    description: dto.description,
    brand: dto.brand,
    originalPrice: dto.originalPrice,
    discountPrice: dto.discountPrice,
    reviewCount: dto.reviewCount,
    videoUrls: dto.videoUrls ?? [],
    variants: dto.variants ?? [],
    skuOptions: (dto.skuOptions ?? []).map((item) => ({
      skuId: item.skuId,
      name: item.name,
      sourceUrl: item.sourceUrl,
      price: Number(item.price) || 0,
      originalPrice: item.originalPrice,
      discountPrice: item.discountPrice,
      imageUrls: item.imageUrls ?? [],
      options: item.options ?? {},
    })),
  };
}

@Controller('collector')
export class CollectorGatewayController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('ingest')
  @RequirePermissions('crawler:task:create')
  ingest(
    @CurrentUser() user: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: AgentProductDto,
  ) {
    return this.crawlerService.ingestDirect(tenantId, user.id, toStandardProduct(dto), {
      crawlAllSkus: dto.crawlAllSkus === true,
    });
  }

  @Post('heartbeat')
  @RequirePermissions('crawler:task:create')
  heartbeat(@CurrentTenantId() tenantId: string | null, @Body() dto: HeartbeatDto) {
    return this.crawlerService.heartbeat(tenantId, {
      ...dto,
      sessionValid: dto.sessionValid ?? false,
    });
  }

  @Get('tasks/claim')
  @RequirePermissions('crawler:task:create')
  claim(@CurrentTenantId() tenantId: string | null, @Query() query: ClaimTaskDto) {
    return this.crawlerService.claimItem(tenantId, query);
  }

  @Post('tasks/:itemId/listing')
  @RequirePermissions('crawler:task:create')
  expandListing(
    @CurrentTenantId() tenantId: string | null,
    @Param('itemId') itemId: string,
    @Body() dto: AgentListingDto,
  ) {
    return this.crawlerService.expandListingFromAgent(itemId, tenantId, dto);
  }

  @Post('tasks/:itemId/result')
  @RequirePermissions('crawler:task:create')
  async result(
    @CurrentTenantId() tenantId: string | null,
    @Param('itemId') itemId: string,
    @Body() dto: AgentResultDto,
  ) {
    if (dto.success) {
      if (!dto.product) {
        throw new BadRequestException('成功回传必须包含 product');
      }
      await this.crawlerService.ingestSuccess(itemId, requireTenantId(tenantId), toStandardProduct(dto.product));
      return { ok: true };
    }
    await this.crawlerService.ingestFailure(itemId, requireTenantId(tenantId), new Error(dto.error || '采集端回传失败'));
    return { ok: true };
  }
}
