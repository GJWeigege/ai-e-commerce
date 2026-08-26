/** 创建采集任务时可配置的选品限制，写入 task.config */
export type CollectFiltersInput = {
  minRating?: number;
  minReviewCount?: number;
  minSalesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
};

export function collectFiltersFromDto(dto: CollectFiltersInput) {
  return {
    minRating: dto.minRating,
    minReviewCount: dto.minReviewCount,
    minSalesCount: dto.minSalesCount,
    minPrice: dto.minPrice,
    maxPrice: dto.maxPrice,
    inStockOnly: dto.inStockOnly === true,
  };
}
