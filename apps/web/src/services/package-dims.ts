import { inspectPackageDimensions, type PackageDimensionGaps } from '@aiecom/shared';
import { Product, ProductSkuOption, productDescription, productSpecs } from './product';

export function inspectProductPackage(product: Product): PackageDimensionGaps {
  const skuOptions = Array.isArray(product.skuOptions)
    ? product.skuOptions.filter(
        (item): item is ProductSkuOption => Boolean(item) && typeof item === 'object' && typeof item.skuId === 'string',
      )
    : [];
  return inspectPackageDimensions(productSpecs(product), {
    name: product.name,
    description: productDescription(product),
    skuOptions,
  });
}

export function productHasPackageGap(product: Product): boolean {
  const gaps = inspectProductPackage(product);
  return gaps.missingSize || gaps.missingWeight;
}
