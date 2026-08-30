import { RuntimeResponseError } from 'wildberries-sdk/items';
import {
  WbHttpClient,
  cargoTypesFromStockError,
  collectWbChrtIds,
  createWbListingAdapter,
  inferWbCargoType,
  rankWbStockWarehouses,
  readWbSdkErrorBody,
  resetWbRateLimiters,
} from '@aiecom/platform-core';

describe('WB seller-warehouse stocks', () => {
  afterEach(() => resetWbRateLimiters());

  it('collects numeric chrtIds from card sizes (Content API uses chrtID)', () => {
    expect(
      collectWbChrtIds([
        { chrtID: 111, techSize: '0', skus: ['a'] },
        { chrtID: 222, techSize: 'M', skus: ['b'] },
        { chrtID: 111, techSize: '0', skus: ['a'] },
        { techSize: 'L', skus: ['c'] },
      ]),
    ).toEqual([111, 222]);
    expect(collectWbChrtIds([{ chrtId: 333 } as never])).toEqual([333]);
    expect(collectWbChrtIds([])).toEqual([]);
  });

  it('PUTs stocks by chrtId, not barcode sku (WB rejects sku since 2026-05-20)', async () => {
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new WbHttpClient({
      token: 'stock-test-token',
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          method: String(init?.method || 'GET'),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return new Response(null, { status: 204 });
      },
      minIntervalMs: 0,
      maxConcurrent: 4,
    });

    await client.setStocks(99, [{ chrtId: 12345678, amount: 10 }]);

    const put = calls.find((item) => item.method === 'PUT' && item.url.includes('/api/v3/stocks/99'));
    expect(put).toBeDefined();
    expect(JSON.parse(put!.body || '{}')).toEqual({
      stocks: [{ chrtId: 12345678, amount: 10 }],
    });
  });

  it('adapter setStocks sends chrtId even when a warehouse id is already known', async () => {
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    const adapter = createWbListingAdapter({
      token: 'adapter-stock-token',
      warehouseId: 77,
      fetchImpl: async (input, init) => {
        calls.push({
          url: String(input),
          method: String(init?.method || 'GET'),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return new Response(null, { status: 204 });
      },
      minIntervalMs: 0,
      maxConcurrent: 4,
    });

    await adapter.setStocks([555], 8, 77);

    const put = calls.find((item) => item.method === 'PUT' && item.url.includes('/api/v3/stocks/77'));
    expect(JSON.parse(put?.body || '{}')).toEqual({
      stocks: [{ chrtId: 555, amount: 8 }],
    });
  });

  it('infers ODC/CD+ cargo type from oversized package dimensions', () => {
    expect(inferWbCargoType({ length: 30, width: 20, height: 10, weightBrutto: 1 })).toBe(1);
    expect(inferWbCargoType({ length: 130, width: 40, height: 40, weightBrutto: 8 })).toBe(2);
    expect(inferWbCargoType({ length: 80, width: 80, height: 80, weightBrutto: 30 })).toBe(2);
    expect(inferWbCargoType({ length: 220, width: 80, height: 80, weightBrutto: 40 })).toBe(3);
  });

  it('ranks ODC/CD+ warehouses ahead of a remembered small-goods warehouse', () => {
    const ranked = rankWbStockWarehouses(
      [
        { id: 11, name: 'FBS MGT', cargoType: 1, deliveryType: 1 },
        { id: 22, name: 'FBS ODC', cargoType: 2, deliveryType: 1 },
        { id: 33, name: 'FBS CD+', cargoType: 3, deliveryType: 1 },
      ],
      { preferredId: 11, cargoType: 2 },
    );
    expect(ranked.map((item) => item.id)).toEqual([22, 33, 11]);
  });

  it('reads ODC/CD+ warehouse restriction from WB stock errors', () => {
    expect(
      cargoTypesFromStockError(
        'The selected warehouse is not suitable for goods with the type "ODC/CD+". Upload the balances to the warehouse with the label - ODC or CD+；CargoWarehouseRestrictionSGTKGTPlus',
      ),
    ).toEqual([2, 3]);
  });

  it('retries an ODC warehouse after the remembered MGT warehouse rejects the cargo type', async () => {
    const puts: string[] = [];
    const adapter = createWbListingAdapter({
      token: 'cargo-retry-token',
      warehouseId: 11,
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET' && url.includes('/api/v3/warehouses')) {
          return new Response(
            JSON.stringify([
              { id: 11, name: 'FBS MGT', cargoType: 1, deliveryType: 1 },
              { id: 22, name: 'FBS ODC', cargoType: 2, deliveryType: 1 },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (method === 'PUT' && url.includes('/api/v3/stocks/')) {
          puts.push(url);
          if (url.includes('/stocks/11')) {
            return new Response(
              JSON.stringify([
                {
                  code: 'CargoWarehouseRestrictionSGTKGTPlus',
                  message:
                    'The selected warehouse is not suitable for goods with the type "ODC/CD+". Upload the balances to the warehouse with the label - ODC or CD+',
                },
              ]),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 204 });
      },
      minIntervalMs: 0,
      maxConcurrent: 4,
    });

    const warehouseId = await adapter.setStocks([555], 8, 11);
    expect(warehouseId).toBe(22);
    expect(puts.some((url) => url.includes('/stocks/11'))).toBe(true);
    expect(puts.some((url) => url.includes('/stocks/22'))).toBe(true);
  });

  it('surfaces WB stock error arrays instead of the SDK generic message', async () => {
    const response = new Response(
      JSON.stringify([
        {
          code: 'IncorrectParameter',
          message: "The 'sku' parameter is no longer supported. Use 'chrtId'",
        },
      ]),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
    const mapped = await readWbSdkErrorBody(new RuntimeResponseError(response, 'Response returned an error code'));
    expect(mapped.status).toBe(400);
    expect(mapped.message).toContain('chrtId');
    expect(mapped.message).not.toBe('Response returned an error code');
  });
});
