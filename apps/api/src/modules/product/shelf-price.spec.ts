import {
  clampDiscount,
  computeShelfStock,
  computeWbShelfPrice,
  discountFromListAndSale,
  listFromSaleAndDiscount,
  resolveManualShelfPrice,
  saleFromListAndDiscount,
} from './shelf-price';

describe('shelf price strategy', () => {
  it('keeps product list/sale and derives discount', () => {
    expect(computeWbShelfPrice({ price: 70, originalPrice: 100, mode: 'keep' })).toEqual({
      listPrice: 100,
      salePrice: 70,
      discount: 30,
    });
  });

  it('applies dual multiplier to list and sale', () => {
    expect(computeWbShelfPrice({ price: 50, originalPrice: 80, mode: 'dual_times', multiplier: 1.5 })).toEqual({
      listPrice: 120,
      salePrice: 74,
      discount: 38,
    });
  });

  it('supports fixed list + discount percent', () => {
    expect(
      computeWbShelfPrice({
        price: 40,
        originalPrice: 80,
        mode: 'fixed_list_discount',
        fixedListPrice: 2000,
        fixedDiscountPercent: 30,
      }),
    ).toEqual({ listPrice: 2000, salePrice: 1400, discount: 30 });
  });

  it('supports fixed list + fixed sale', () => {
    expect(
      computeWbShelfPrice({
        price: 40,
        mode: 'fixed_list_sale',
        fixedListPrice: 1000,
        fixedSalePrice: 800,
      }),
    ).toEqual({ listPrice: 1000, salePrice: 800, discount: 20 });
  });

  it('supports fixed sale + discount percent', () => {
    expect(
      computeWbShelfPrice({
        price: 40,
        mode: 'fixed_sale_discount',
        fixedSalePrice: 700,
        fixedDiscountPercent: 30,
      }),
    ).toEqual({ listPrice: 1000, salePrice: 700, discount: 30 });
  });

  it('resolves manual list + discount for WB upload', () => {
    expect(
      resolveManualShelfPrice({
        listPrice: 1990,
        discountPercent: 30,
        fallbackList: 100,
        fallbackSale: 80,
      }),
    ).toEqual({ listPrice: 1990, salePrice: 1393, discount: 30 });
  });

  it('resolves manual list + sale into discount', () => {
    expect(discountFromListAndSale(1000, 750)).toBe(25);
    expect(saleFromListAndDiscount(1000, 25)).toBe(750);
    expect(listFromSaleAndDiscount(750, 25)).toBe(1000);
    expect(clampDiscount(100)).toBe(99);
  });

  it('computes WB list/sale from crawled original, discount and actual prices', () => {
    expect(
      computeWbShelfPrice({
        price: 80,
        originalPrice: 120,
        discountPrice: 100,
        mode: 'from_sources',
        listSource: 'original',
        saleSource: 'discount',
        multiplier: 1.5,
        saleMultiplier: 1.1,
      }),
    ).toEqual({ listPrice: 180, salePrice: 110, discount: 39 });
    expect(
      computeWbShelfPrice({
        price: 80,
        originalPrice: 120,
        discountPrice: 100,
        mode: 'from_sources',
        listSource: 'discount',
        saleSource: 'sale',
        multiplier: 1,
        saleMultiplier: 1,
      }),
    ).toEqual({ listPrice: 100, salePrice: 80, discount: 20 });
  });

  it('normalizes stock', () => {
    expect(computeShelfStock(undefined, 0)).toBe(0);
    expect(computeShelfStock(12.8)).toBe(13);
    expect(computeShelfStock(-4)).toBe(0);
  });
});
