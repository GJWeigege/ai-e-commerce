import { OzonWarehouseFilter } from '@aiecom/shared';

/** 创建采集任务时可配置的选品限制，写入 task.config */
export type CollectFiltersInput = {
  minRating?: number;
  minReviewCount?: number;
  minSalesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  requireSizeAndWeight?: boolean;
  minStockQuantity?: number;
  warehouseType?: OzonWarehouseFilter;
};

export function collectFiltersFromDto(dto: CollectFiltersInput): {
  minRating?: number;
  minReviewCount?: number;
  minSalesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly: boolean;
  requireSizeAndWeight: boolean;
  minStockQuantity?: number;
  warehouseType: OzonWarehouseFilter;
} {
  const warehouseType: OzonWarehouseFilter =
    dto.warehouseType === 'FBO' || dto.warehouseType === 'FBS' ? dto.warehouseType : 'ALL';
  return {
    minRating: dto.minRating,
    minReviewCount: dto.minReviewCount,
    minSalesCount: dto.minSalesCount,
    minPrice: dto.minPrice,
    maxPrice: dto.maxPrice,
    inStockOnly: dto.inStockOnly === true,
    requireSizeAndWeight: dto.requireSizeAndWeight !== false,
    minStockQuantity: dto.minStockQuantity,
    warehouseType,
  };
}
