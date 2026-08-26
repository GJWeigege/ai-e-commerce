import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canShowOffShelfAction, canShowOnShelfAction } from './listing-status';
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
