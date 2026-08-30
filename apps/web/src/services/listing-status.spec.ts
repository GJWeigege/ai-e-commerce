import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canDeleteProduct, canShowOffShelfAction, canShowOnShelfAction } from './listing-status';
import type { Product, ProductShopListing } from './product';

function listing(partial: Partial<ProductShopListing>): ProductShopListing {
  return {
    id: partial.id ?? 'listing-1',
    shopId: partial.shopId ?? 'shop-1',
    status: partial.status ?? 'NONE',
    wbNmId: partial.wbNmId ?? null,
    error: partial.error ?? null,
    wbVendorCode: partial.wbVendorCode ?? null,
    listedAt: partial.listedAt ?? null,
    shop: partial.shop ?? { id: 'shop-1', name: '店铺1', platform: 'WILDBERRIES', status: 'ENABLED' },
  };
}

function product(partial: Partial<Product> = {}): Pick<Product, 'status' | 'wbListingStatus' | 'shopListings'> {
  return {
    status: partial.status ?? 'APPROVED',
    wbListingStatus: partial.wbListingStatus ?? 'NONE',
    shopListings: partial.shopListings ?? [],
  };
}

describe('canShowOnShelfAction', () => {
  it('hides 上架 while card creation is queued or processing', () => {
    assert.equal(
      canShowOnShelfAction(
        product({
          wbListingStatus: 'PROCESSING',
          shopListings: [listing({ status: 'PROCESSING' })],
        }),
      ),
      false,
    );
    assert.equal(
      canShowOnShelfAction(
        product({
          wbListingStatus: 'QUEUED',
          shopListings: [listing({ status: 'QUEUED' })],
        }),
      ),
      false,
    );
  });

  it('shows 上架 after card creation ends without a live listing', () => {
    assert.equal(canShowOnShelfAction(product({ wbListingStatus: 'NONE' })), true);
    assert.equal(canShowOnShelfAction(product({ status: 'CRAWLED', wbListingStatus: 'NONE' })), true);
    assert.equal(canShowOnShelfAction(product({ status: 'AI_PENDING', wbListingStatus: 'NONE' })), true);
    assert.equal(canShowOnShelfAction(product({ status: 'REVIEW_PENDING', wbListingStatus: 'NONE' })), true);
    assert.equal(canShowOnShelfAction(product({ status: 'REJECTED', wbListingStatus: 'NONE' })), false);
    assert.equal(
      canShowOnShelfAction(
        product({
          status: 'OFF_SHELF',
          wbListingStatus: 'UNLISTED',
          shopListings: [listing({ status: 'UNLISTED', wbNmId: 1 })],
        }),
      ),
      true,
    );
    assert.equal(
      canShowOnShelfAction(
        product({
          wbListingStatus: 'FAILED',
          shopListings: [listing({ status: 'FAILED' })],
        }),
      ),
      true,
    );
  });
});

describe('canShowOffShelfAction', () => {
  it('hides 下架 while card creation is in progress', () => {
    assert.equal(
      canShowOffShelfAction(
        product({
          wbListingStatus: 'PROCESSING',
          shopListings: [listing({ status: 'PROCESSING' })],
        }),
      ),
      false,
    );
  });

  it('shows 下架 after the card is listed', () => {
    assert.equal(
      canShowOffShelfAction(
        product({
          status: 'ON_SHELF',
          wbListingStatus: 'LISTED',
          shopListings: [listing({ status: 'LISTED', wbNmId: 4115958654 })],
        }),
      ),
      true,
    );
  });

  it('shows 下架 after failure only when a WB nmID remains', () => {
    assert.equal(
      canShowOffShelfAction(
        product({
          wbListingStatus: 'FAILED',
          shopListings: [listing({ status: 'FAILED', wbNmId: 1471419881 })],
        }),
      ),
      true,
    );
    assert.equal(
      canShowOffShelfAction(
        product({
          wbListingStatus: 'FAILED',
          shopListings: [listing({ status: 'FAILED', wbNmId: null })],
        }),
      ),
      false,
    );
  });
});

describe('canDeleteProduct', () => {
  it('allows catalog delete when listing is idle and not live on WB', () => {
    assert.equal(canDeleteProduct(product({ status: 'APPROVED', wbListingStatus: 'NONE' })), true);
  });

  it('blocks catalog delete while listed or a WB nmID remains', () => {
    assert.equal(
      canDeleteProduct(
        product({
          status: 'ON_SHELF',
          wbListingStatus: 'LISTED',
          shopListings: [listing({ status: 'LISTED', wbNmId: 1 })],
        }),
      ),
      false,
    );
    assert.equal(
      canDeleteProduct(
        product({
          wbListingStatus: 'FAILED',
          shopListings: [listing({ status: 'FAILED', wbNmId: 1 })],
        }),
      ),
      false,
    );
  });

  it('blocks catalog delete while card creation is queued or processing', () => {
    assert.equal(
      canDeleteProduct(
        product({
          wbListingStatus: 'QUEUED',
          shopListings: [listing({ status: 'QUEUED' })],
        }),
      ),
      false,
    );
    assert.equal(
      canDeleteProduct(
        product({
          wbListingStatus: 'PROCESSING',
          shopListings: [listing({ status: 'PROCESSING' })],
        }),
      ),
      false,
    );
  });
});
