import {
  parseProductUrlsFromCsv,
  mergeCollectorConfig,
  collectFilterMismatch,
  applyOzonListingFilters,
  listingHarvestLimit,
  listingQuotaDeficit,
  nextListingBackfill,
  splitListingQueue,
} from '@aiecom/collector-core';
import { detectCaptchaOrBlock } from '@aiecom/collector-core';
import { withRetry, CaptchaDetectedError } from '@aiecom/collector-core';
import { extractOzonProductFromHtml, buildSkuOptions, parseOzonWidgetPage, parseLabeledDescriptionSpecs, warehouseSpecsFromCharacteristics } from '@aiecom/collector-core';
import { buildOzonCategoryListingUrl, extractOzonProductUrls, isOzonListingUrl, pickOzonProductUrls, toAllowedCollectUrl } from '@aiecom/collector-core';
import { alignSkuOptions, combineFamilyListings, fillSkuOptionsFromVariants, inferWeightOption, isSameOzonFamily, keepMainSkuOnly, ozonListingSlugFamily, productFamilyKey } from '@aiecom/shared';
import { scoreProduct } from '@aiecom/llm-core';
import { PRODUCT_REVIEW_QUEUE_STATUSES } from '../product/product-status';

describe('parseProductUrlsFromCsv', () => {
  it('reads url column from header', () => {
    const csv = 'name,url\nfoo,https://www.ozon.ru/product/item-1000001/\nbar,https://www.ozon.ru/product/item-2000002/';
    expect(parseProductUrlsFromCsv(csv)).toEqual([
      'https://www.ozon.ru/product/item-1000001/',
      'https://www.ozon.ru/product/item-2000002/',
    ]);
  });

  it('keeps ozon product urls and drops unrelated hosts', () => {
    expect(
      parseProductUrlsFromCsv(
        'https://www.ozon.ru/product/item-1000001/\nhttps://evil.example/product/999999/\nnot-a-url',
      ),
    ).toEqual(['https://www.ozon.ru/product/item-1000001/']);
  });
});

describe('mergeCollectorConfig', () => {
  it('defaults crawlAllSkus to false', () => {
    expect(mergeCollectorConfig().crawlAllSkus).toBe(false);
    expect(mergeCollectorConfig({}).crawlAllSkus).toBe(false);
    // 批量多规格暂时关闭：即便任务配置写了 true，运行时也只采当前 skuId
    expect(mergeCollectorConfig({ crawlAllSkus: 'true' }).crawlAllSkus).toBe(false);
    expect(mergeCollectorConfig({ crawlAllSkus: true }).crawlAllSkus).toBe(false);
  });

  it('parses optional collect filters from numbers or form strings', () => {
    expect(mergeCollectorConfig({ minRating: '4.5', minReviewCount: '10', inStockOnly: 'true' })).toMatchObject({
      minRating: 4.5,
      minReviewCount: 10,
      inStockOnly: true,
    });
    expect(mergeCollectorConfig({}).minRating).toBeUndefined();
    expect(mergeCollectorConfig({}).inStockOnly).toBe(false);
  });
});

describe('collectFilterMismatch', () => {
  const product = { rating: 4.6, reviewCount: 20, salesCount: 80, price: 1200, stock: 5 };

  it('returns null when no filters are set', () => {
    expect(collectFilterMismatch(product, mergeCollectorConfig())).toBeNull();
  });

  it('rejects products below the configured rating / reviews / price', () => {
    expect(collectFilterMismatch(product, mergeCollectorConfig({ minRating: 4.8 }))).toContain('评分');
    expect(collectFilterMismatch(product, mergeCollectorConfig({ minReviewCount: 50 }))).toContain('评价数');
    expect(collectFilterMismatch({ ...product, stock: 0 }, mergeCollectorConfig({ inStockOnly: true }))).toContain('库存');
    expect(collectFilterMismatch(product, mergeCollectorConfig({ minPrice: 100, maxPrice: 2000 }))).toBeNull();
  });
});

describe('ozon category listing url', () => {
  it('uses the numeric catalog id instead of searching chinese keywords', () => {
    expect(buildOzonCategoryListingUrl({ categoryId: '7511', categoryName: '女式衬衫和衬衫' })).toBe(
      'https://www.ozon.ru/category/7511/',
    );
  });

  it('keeps a pasted ozon category url', () => {
    expect(
      buildOzonCategoryListingUrl({
        categoryName: 'https://www.ozon.ru/category/bluzy-i-rubashki-zhenskie-7511/?from=foo',
      }),
    ).toBe('https://www.ozon.ru/category/bluzy-i-rubashki-zhenskie-7511/');
  });

  it('appends rating and price filters to the listing url for chrome to open', () => {
    expect(
      applyOzonListingFilters('https://www.ozon.ru/category/7511/', { minRating: 4.5, minPrice: 500, maxPrice: 8000 }),
    ).toBe('https://www.ozon.ru/category/7511/?rating=4.5&currency_price=500.000%3B8000.000');
  });

  it('detects listing pages so chrome can expand them', () => {
    expect(isOzonListingUrl('https://www.ozon.ru/category/7511/')).toBe(true);
    expect(isOzonListingUrl('https://www.ozon.ru/product/bluzka-4000001111/')).toBe(false);
    expect(isOzonListingUrl('https://evil.example/?next=ozon.ru/category/7511/')).toBe(false);
    expect(toAllowedCollectUrl('https://evil.example/product/item-1000001/')).toBeNull();
    expect(toAllowedCollectUrl('https://www.ozon.ru/product/item-1000001/')).toBe(
      'https://www.ozon.ru/product/item-1000001/',
    );
  });

  it('harvests extra listing urls so skipped products can be backfilled to topN', () => {
    expect(listingHarvestLimit(10)).toBe(30);
    const urls = Array.from({ length: 20 }, (_, i) => `https://www.ozon.ru/product/item-${1000000000 + i}/`);
    const split = splitListingQueue(urls, 10);
    expect(split.immediate).toHaveLength(10);
    expect(split.pool).toHaveLength(10);
    expect(listingQuotaDeficit(10, { success: 8, inFlight: 0 })).toBe(2);
    expect(
      nextListingBackfill(split.pool, split.immediate, 2),
    ).toEqual({
      next: split.pool.slice(0, 2),
      remaining: split.pool.slice(2),
    });
  });

  it('keeps the first unique product urls up to topN', () => {
    expect(
      pickOzonProductUrls(
        [
          'https://www.ozon.ru/category/7511/',
          '/product/bluzka-belaya-4000001111/?at=1',
          'https://www.ozon.ru/product/bluzka-chernaya-4000002222/',
          '/product/bluzka-belaya-4000001111/',
        ],
        10,
      ),
    ).toEqual([
      'https://www.ozon.ru/product/bluzka-belaya-4000001111/',
      'https://www.ozon.ru/product/bluzka-chernaya-4000002222/',
    ]);
  });
});

describe('extractOzonProductUrls', () => {
  it('keeps real product paths and skips mock urls', () => {
    const html =
      'href="/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/" ' +
      'href="/product/mock-咖啡-834656550/" ' +
      'href="https://www.ozon.ru/product/other-item-200000111/"';
    expect(extractOzonProductUrls(html, 10)).toEqual([
      'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/',
      'https://www.ozon.ru/product/other-item-200000111/',
    ]);
  });
});

describe('parseComposerProduct', () => {
  it('reads seo json-ld product fields', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '1085845200',
        name: 'Кофе в зернах Tasty Coffee Брауни 1 кг',
        image: 'https://cdn.ozon.ru/coffee.jpg',
        offers: { price: 1290 },
      })}</script></head><body></body></html>`,
      'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/',
    );
    expect(product).toMatchObject({
      skuId: '1085845200',
      name: 'Кофе в зернах Tasty Coffee Брауни 1 кг',
      price: 1290,
      currency: 'RUB',
    });
  });
});

describe('captcha detection', () => {
  it('detects russian robot challenge', () => {
    expect(detectCaptchaOrBlock('Пожалуйста подтвердите что вы не робот')).toBe(true);
  });

  it('passes normal product html', () => {
    expect(detectCaptchaOrBlock('<h1>Наушники</h1>')).toBe(false);
  });

  it('does not treat a rendered product page as blocked just because captcha sdk is in html', () => {
    const html = `
      <html>
        <head>
          <script>window.__ozonCaptcha = { provider: "recaptcha" };</script>
          <script type="application/ld+json">{"@type":"Product","name":"Кофе в зернах Tasty Coffee Брауни, 1 кг","sku":"1085845200"}</script>
        </head>
        <body>
          <h1>Кофе в зернах Tasty Coffee Брауни, 1 кг</h1>
          <div data-widget="webPrice">1 290 ₽</div>
        </body>
      </html>`;
    expect(detectCaptchaOrBlock(html)).toBe(false);
  });
});

describe('ozon html extract', () => {
  it('reads images, description and specs from a product page', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://ir.ozone.ru/s3/multimedia-1/wc50/cover.jpg" />
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг',
            description: 'Ароматный кофе с нотами брауни.',
            image: ['https://ir.ozone.ru/s3/multimedia-1/wc1000/1.jpg'],
            offers: { price: 1290, priceCurrency: 'RUB' },
            additionalProperty: [{ '@type': 'PropertyValue', name: 'Бренд', value: 'Tasty Coffee' }],
            aggregateRating: { ratingValue: 4.8 },
          })}</script>
        </head>
        <body>
          <h1>Кофе в зернах Tasty Coffee Брауни, 1 кг</h1>
          <img src="https:\\/\\/ir.ozone.ru\\/s3\\/multimedia-1\\/wc1000\\/2.jpg" />
          <div data-widget="webCharacteristics">
            <dl><dt>Вес</dt><dd>1 кг</dd></dl>
          </div>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/',
    );
    expect(product.skuId).toBe('1085845200');
    expect(product.name).toContain('Tasty Coffee');
    expect(product.price).toBe(1290);
    expect(product.description).toContain('брауни');
    expect(product.imageUrls?.some((url) => url.includes('wc1000'))).toBe(true);
    expect(product.mainImageUrl).toContain('ir.ozone.ru');
    expect(product.specs?.some((item) => item.name === 'Бренд' && item.value === 'Tasty Coffee')).toBe(true);
    expect(product.brand).toBe('Tasty Coffee');
  });

  it('reads gallery images and variant options from ozon widgetStates', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг',
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-1': JSON.stringify({
                images: [
                  { src: 'https://ir.ozone.ru/s3/multimedia-1/wc50/a.jpg', original: 'https://ir.ozone.ru/s3/multimedia-1/wc1200/a.jpg' },
                  { src: 'https://ir.ozone.ru/s3/multimedia-2/wc1200/b.jpg' },
                  { src: 'https://ir.ozone.ru/s3/multimedia-3/wc1200/c.jpg' },
                ],
              }),
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    name: 'Вес товара, г',
                    values: [
                      { value: '250', isSelected: false, link: '/product/coffee-250-1111111111/' },
                      { value: '1000', isSelected: true, sku: '1085845200' },
                    ],
                  },
                  {
                    name: 'Название вкуса',
                    values: [
                      { value: 'Брауни', isSelected: true },
                      { value: 'Бэрри', isSelected: false, link: '/product/coffee-berry-2222222222/' },
                    ],
                  },
                ],
              }),
              'webCharacteristics-1': JSON.stringify({
                characteristics: [
                  { title: 'Тип', values: [{ text: 'Кофе в зернах' }] },
                  { title: 'Степень обжарки', values: [{ text: 'Темная' }] },
                ],
              }),
              'webPrice-1': JSON.stringify({ price: '2476', originalPrice: '3506' }),
            },
          })}</script>
        </head>
        <body><h1>Кофе в зернах Tasty Coffee Брауни, 1 кг</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/',
    );
    expect(product.imageUrls?.length).toBeGreaterThanOrEqual(3);
    expect(product.variants?.some((item) => item.name.includes('Вес') && item.values.length >= 2)).toBe(true);
    expect(product.variants?.some((item) => item.values.some((value) => value.value === 'Бэрри'))).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Тип')).toBe(true);
    expect(product.originalPrice).toBe(3506);
    expect(product.price).toBe(2476);
    expect(product.discountPrice).toBe(2476);
  });

  it('captures package dimensions from characteristics, ozon depth blob and title', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '4115958654',
            name: 'Коврик для сушки посуды 30x40 см',
            offers: { price: 390 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webCharacteristics-1': JSON.stringify({
                characteristicsList: [
                  { name: 'Длина, мм', values: ['400'] },
                  { name: 'Ширина, мм', values: ['300'] },
                  { name: 'Высота, мм', values: ['20'] },
                  { name: 'Вес товара, г', values: ['450'] },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Коврик для сушки посуды 30x40 см</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/kovrik-dlya-sushki-posudy-30x40-sm-4115958654/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '400')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '450')).toBe(true);

    const titleOnly = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '3400831917',
        name: 'Ситечко для заварки 8x8x12 см',
        offers: { price: 190 },
      })}</script></head><body><h1>Ситечко для заварки 8x8x12 см</h1></body></html>`,
      'https://www.ozon.ru/product/sitechko-3400831917/',
    );
    expect(titleOnly.specs?.some((item) => /габарит|размер/i.test(item.name) && /8/.test(item.value))).toBe(true);

    const fromBlob = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webPdp-1': JSON.stringify({
            sku: '555',
            name: 'Box',
            depth: 250,
            width: 180,
            height: 60,
            weight: 800,
          }),
        },
      })}</script></head><body><h1>Box</h1></body></html>`,
      'https://www.ozon.ru/product/box-555555/',
    );
    expect(fromBlob.specs?.some((item) => item.name === 'Длина, мм' && item.value === '250')).toBe(true);
    expect(fromBlob.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '800')).toBe(true);
  });

  it('reads ozon tracking dimension string and grams like seerfar 211x46x24mm / 49g', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка 40cm',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webSale-1': JSON.stringify({
            cellTrackingInfo: {
              product: {
                id: 2974096117,
                sku: 2974096117,
                title: 'Портативная электрогрелка',
                original: 1290,
                price: 990,
                dimension: '211x46x24',
                weight: 49,
              },
            },
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Ширина, мм' && item.value === '46')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Высота, мм' && item.value === '24')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);
  });

  it('keeps tracking 211x46x24mm even when the PDP also has marketing Габариты 10*22 см', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webSale-1': JSON.stringify({
            cellTrackingInfo: {
              product: {
                id: 2974096117,
                sku: 2974096117,
                dimension: '211x46x24',
                weight: 49,
              },
            },
          }),
          'webShortCharacteristics-1': JSON.stringify({
            short: [{ title: 'Габариты', values: [{ text: '10*22 см' }] }],
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1><p>Размер: 10*22 см/20*40 см</p></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);
  });

  it('reads ozon textRs characteristic rows for mm size and grams', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webCharacteristics-31-pdpPage2column': JSON.stringify({
            characteristics: [
              {
                title: { textRs: [{ type: 'text', content: 'Длина, мм' }] },
                values: [{ text: '211' }],
              },
              {
                title: { textRs: [{ type: 'text', content: 'Ширина, мм' }] },
                values: [{ text: '46' }],
              },
              {
                title: { textRs: [{ type: 'text', content: 'Высота, мм' }] },
                values: [{ text: '24' }],
              },
              {
                title: { textRs: [{ type: 'text', content: 'Вес товара, г' }] },
                values: [{ text: '49' }],
              },
            ],
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Ширина, мм' && item.value === '46')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Высота, мм' && item.value === '24')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);
  });

  it('captures nested dimensions, page-2 long params and delivery widgets', () => {
    const nested = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webPdp-1': JSON.stringify({
            sku: '777888999',
            dimensions: { width: 180, depth: 250, height: 60 },
            weight: 800,
          }),
        },
      })}</script></head><body><h1>Box</h1></body></html>`,
      'https://www.ozon.ru/product/box-777888999/',
    );
    expect(nested.specs?.some((item) => item.name === 'Длина, мм' && item.value === '250')).toBe(true);
    expect(nested.specs?.some((item) => item.name === 'Ширина, мм' && item.value === '180')).toBe(true);
    expect(nested.specs?.some((item) => item.name === 'Высота, мм' && item.value === '60')).toBe(true);
    expect(nested.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '800')).toBe(true);

    const page2 = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '4115958654',
        name: 'Коврик',
        offers: { price: 390 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webCharacteristics-31-pdpPage2column': JSON.stringify({
            characteristics: [
              {
                title: 'Габариты',
                long: [
                  { name: 'Длина, мм', values: [{ text: '400' }] },
                  { name: 'Ширина, мм', values: [{ text: '300' }] },
                  { name: 'Высота, мм', values: [{ text: '20' }] },
                  { name: 'Вес товара, г', values: [{ text: '450' }] },
                ],
              },
            ],
          }),
        },
      })}</script></head><body><h1>Коврик</h1></body></html>`,
      'https://www.ozon.ru/product/kovrik-4115958654/',
    );
    expect(page2.specs?.some((item) => item.name === 'Длина, мм' && item.value === '400')).toBe(true);
    expect(page2.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '450')).toBe(true);

    const delivery = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webDelivery-1': JSON.stringify({
            sku: '3400831917',
            dimensions: { length: 120, width: 80, height: 40 },
            weight: 350,
          }),
        },
      })}</script></head><body><h1>Filter</h1></body></html>`,
      'https://www.ozon.ru/product/filter-3400831917/',
    );
    expect(delivery.specs?.some((item) => item.name === 'Длина, мм' && item.value === '120')).toBe(true);
    expect(delivery.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '350')).toBe(true);
  });

  it('reads long/short characteristic objects, unicode-escaped widgets, volume string and Вес, г', () => {
    const grouped = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Грелка',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webCharacteristics-1': JSON.stringify({
            characteristics: {
              short: [{ title: 'Цвет', values: [{ text: 'Черный' }] }],
              long: [
                { title: { textRs: [{ content: 'Длина упаковки, мм' }] }, values: [{ text: '211' }] },
                { title: { textRs: [{ content: 'Ширина, мм' }] }, values: [{ text: '46' }] },
                { title: { textRs: [{ content: 'Высота, мм' }] }, values: [{ text: '24' }] },
                { title: { textRs: [{ content: 'Вес, г' }] }, values: [{ text: '49' }] },
              ],
            },
          }),
        },
      })}</script></head><body><h1>Грелка</h1></body></html>`,
      'https://www.ozon.ru/product/grelka-2974096117/',
    );
    expect(grouped.specs?.some((item) => item.name === 'Длина упаковки, мм' && item.value === '211')).toBe(true);
    expect(grouped.specs?.some((item) => item.name === 'Вес, г' && item.value === '49')).toBe(true);

    const unicodeWidget =
      '{"cellTrackingInfo":{"product":{"sku":2974096117,"dimension":"211x46x24","weight":49}},"characteristics":[{"title":"\\u0414\\u043b\\u0438\\u043d\\u0430, \\u043c\\u043c","values":[{"text":"211"}]},{"title":"\\u0412\\u0435\\u0441, \\u0433","values":[{"text":"49"}]}]}';
    const unicode = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: { 'webSale-1': unicodeWidget },
      })}</script></head><body><h1>Грелка</h1></body></html>`,
      'https://www.ozon.ru/product/grelka-2974096117/',
    );
    expect(unicode.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(unicode.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);

    const volume = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webPdp-1': JSON.stringify({ sku: '2974096117', volume: '211x46x24', weight: '49 г' }),
        },
      })}</script></head><body><h1>Грелка</h1></body></html>`,
      'https://www.ozon.ru/product/grelka-2974096117/',
    );
    expect(volume.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(volume.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);
  });

  it('parses webShortCharacteristics textRs into warehouse weight and size', () => {
    const parsed = parseOzonWidgetPage({
      widgetStates: {
        'webShortCharacteristics-1-default-1': JSON.stringify({
          characteristics: [
            { title: { textRs: [{ text: 'Бренд' }] }, values: [{ text: 'Samsung' }] },
            { title: { textRs: [{ text: 'Вес' }] }, values: [{ text: '1.5 кг' }] },
            { title: { textRs: [{ text: 'Размеры' }] }, values: [{ text: '20 × 30 × 10 см' }] },
            { title: { textRs: [{ text: 'Материал' }] }, values: [{ text: 'Пластик' }] },
          ],
        }),
        'webPrice-3121879-default-1': JSON.stringify({ cardPrice: '53 022 ₽' }),
      },
    });
    expect(parsed.specs).toEqual(
      expect.arrayContaining([
        { name: 'Бренд', value: 'Samsung' },
        { name: 'Вес', value: '1.5 кг' },
        { name: 'Размеры', value: '20 × 30 × 10 см' },
        { name: 'Материал', value: 'Пластик' },
      ]),
    );
    expect(parsed.warehouse).toEqual(
      expect.arrayContaining([
        { name: 'Длина, мм', value: '200' },
        { name: 'Ширина, мм', value: '300' },
        { name: 'Высота, мм', value: '100' },
        { name: 'Вес товара, г', value: '1500' },
      ]),
    );
    expect(warehouseSpecsFromCharacteristics([{ name: 'Вес, кг', value: '4.5' }])).toEqual([
      { name: 'Вес товара, г', value: '4500' },
    ]);

    const html = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webShortCharacteristics-9-pdpPage2column-2': JSON.stringify({
            characteristics: [
              { title: { textRs: [{ content: 'Вес, кг' }] }, values: [{ text: '4.5' }] },
              { title: { textRs: [{ content: 'Размеры' }] }, values: [{ text: '20 × 30 × 10 см' }] },
            ],
          }),
        },
      })}</script></head><body><h1>Acer</h1></body></html>`,
      'https://www.ozon.ru/product/acer-5494720969/',
    );
    expect(html.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '4500')).toBe(true);
    expect(html.specs?.some((item) => item.name === 'Длина, мм' && item.value === '200')).toBe(true);
  });

  it('parses page-2 webCharacteristics nested short rows (Acer laptop live shape)', () => {
    const parsed = parseOzonWidgetPage({
      widgetStates: {
        'webCharacteristics-3282540-pdpPage2column-2': JSON.stringify({
          totalCount: 58,
          characteristics: [
            {
              short: [
                { key: 'CPUName', name: 'Процессор', values: [{ text: 'Intel Core i9-14900HX' }] },
                { key: 'MaxWeight', name: 'Вес, кг', values: [{ text: '4.5' }] },
                { key: 'Brand', name: 'Бренд', values: [{ text: 'Acer' }] },
                { key: 'Resolution', name: 'Разрешение экрана', values: [{ text: '2560x1600' }] },
              ],
            },
          ],
        }),
      },
    });
    expect(parsed.specs).toEqual(
      expect.arrayContaining([
        { name: 'Процессор', value: 'Intel Core i9-14900HX' },
        { name: 'Вес, кг', value: '4.5' },
        { name: 'Бренд', value: 'Acer' },
      ]),
    );
    expect(parsed.warehouse).toEqual([{ name: 'Вес товара, г', value: '4500' }]);
    expect(parsed.specs.some((item) => item.name === 'Длина, мм')).toBe(false);
  });

  it('reads description labeled fields as specs without treating Размер as warehouse package', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка',
        description: 'Цвет: черный\nМатериал: углеродное волокно\nТемпература: 60-70 °\nРазмер: 10*22 см/20*40 см',
        offers: { price: 990 },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Материал' && /углерод/i.test(item.value))).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Размер' && /10/.test(item.value))).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Габариты')).toBe(false);
  });

  it('maps heater description Размер plus thickness, and labeled Вес: 30 г, to warehouse specs', () => {
    expect(
      warehouseSpecsFromCharacteristics([
        { name: 'Толщина', value: 'около 0,5 мм' },
        { name: 'Размер', value: '10*22 см/20*40 см' },
      ]),
    ).toEqual([
      { name: 'Длина, мм', value: '400' },
      { name: 'Ширина, мм', value: '200' },
      { name: 'Высота, мм', value: '1' },
    ]);
    expect(warehouseSpecsFromCharacteristics([{ name: 'Вес', value: '30 г' }])).toEqual([
      { name: 'Вес товара, г', value: '30' },
    ]);

    const heater = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webDescription-1-pdpPage2column-2': JSON.stringify({
            richAnnotation:
              'Описание:\nНебольшой размер и легкий вес, портативный.\nСпецификация:\nТолщина: около 0,5 мм\nРазмер: 10*22 см/20*40 см\n',
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(heater.specs?.some((item) => item.name === 'Длина, мм' && item.value === '400')).toBe(true);
    expect(heater.specs?.some((item) => item.name === 'Ширина, мм' && item.value === '200')).toBe(true);
    expect(heater.specs?.some((item) => item.name === 'Высота, мм' && item.value === '1')).toBe(true);
    expect(heater.specs?.some((item) => item.name === 'Вес товара, г')).toBe(false);

    const white = extractOzonProductFromHtml(
      `<html><head><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webDescription-1-pdpPage2column-2': JSON.stringify({
            richAnnotation: 'Цвет: белый\nРазмер: S (8,5 см x 14 см),L (8,5 см x 19 см)\nВес: 30 г\nМатериал: углеродное волокно',
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2975064358/',
    );
    expect(white.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '30')).toBe(true);
  });

  it('collects original, discount and card prices plus JSON-LD brand', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Coffee',
            brand: { '@type': 'Brand', name: 'Tasty Coffee' },
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webPrice-1': JSON.stringify({
                originalPrice: '3506',
                price: '2690',
                cardPrice: '2476',
                marketingPrice: '2690',
              }),
            },
          })}</script>
        </head>
        <body><h1>Coffee</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1085845200/');
    expect(product.brand).toBe('Tasty Coffee');
    expect(product.originalPrice).toBe(3506);
    expect(product.discountPrice).toBe(2690);
    expect(product.price).toBe(2476);
  });

  it('keeps gallery photos and drops merchant icons', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Coffee',
            image: ['https://ir.ozone.ru/s3/multimedia-1/wc1000/product.jpg'],
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-1': JSON.stringify({
                images: [
                  { src: 'https://ir.ozone.ru/s3/multimedia-1/wc1200/bag.jpg' },
                  { src: 'https://ir.ozone.ru/s3/multimedia-2/wc1200/beans.jpg' },
                ],
              }),
              'webBrand-1': JSON.stringify({
                logo: 'https://ir.ozone.ru/s3/cms/logo-tasty-coffee.png',
                src: 'https://cdn1.ozon.ru/graphics/brand-icon.svg',
              }),
            },
          })}</script>
        </head>
        <body>
          <img src="https://cdn1.ozon.ru/graphics/payment-card.png" />
          <img src="https://ir.ozone.ru/s3/cms/icons/flame-badge.png" />
          <h1>Coffee</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1085845200/');
    expect(product.imageUrls?.some((url) => /bag|beans|product/i.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /logo|icon|graphics|cms|payment|flame/i.test(url))).toBe(false);
  });

  it('drops tiny badge-sized gallery images', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Coffee',
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-1': JSON.stringify({
                images: [
                  { src: 'https://ir.ozone.ru/s3/multimedia-1/wc1200/bag.jpg', width: 1200, height: 1200 },
                  { src: 'https://ir.ozone.ru/s3/multimedia-9/wc1200/badge-tiny.jpg', width: 64, height: 64, type: 'icon' },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Coffee</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1085845200/');
    expect(product.imageUrls?.some((url) => /bag/i.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /badge-tiny/i.test(url))).toBe(false);
  });

  it('reads current ozon gallery url/coverImage/media and does not collapse c600 variants', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn1.ozonusercontent.com/s3/marketing-api/banners/xx/wc1200/promo.png" />
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1547167821',
            name: 'Консервный нож Rondell RD-1877',
            offers: { price: 85 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-pdp-1': JSON.stringify({
                coverImage: 'https://ir.ozone.ru/s3/multimedia-1-z/c600/1111111111.jpg',
                media: [
                  { type: 'image', url: 'https://ir.ozone.ru/s3/multimedia-1-z/c600/1111111111.jpg' },
                  { type: 'image', image: { url: 'https://ir.ozone.ru/s3/multimedia-1-y/c600/2222222222.jpg' } },
                ],
                images: [
                  { url: 'https://ir.ozone.ru/s3/multimedia-1-z/c600/1111111111.jpg' },
                  { url: 'https://ir.ozone.ru/s3/multimedia-1-y/c600/2222222222.jpg' },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <h1>Консервный нож Rondell RD-1877</h1>
          <div id="state-webGallery-1" data-widget="webGalleryPdp" data-state="${JSON.stringify({
            images: [{ url: 'https://ir.ozone.ru/s3/multimedia-1-x/wc1200/3333333333.jpg' }],
          }).replace(/"/g, '&quot;')}"></div>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/konservnyy-nozh-rondell-rd-1877-1547167821/',
    );
    expect(product.imageUrls?.some((url) => url.includes('1111111111.jpg'))).toBe(true);
    expect(product.imageUrls?.some((url) => url.includes('2222222222.jpg'))).toBe(true);
    expect(product.imageUrls?.some((url) => url.includes('3333333333.jpg'))).toBe(true);
    expect(product.imageUrls?.some((url) => /marketing-api|banners|promo/i.test(url))).toBe(false);
  });

  it('keeps webGallery photos and drops recommendation carousel images', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '3492958110',
            name: 'Насадка для нарезки кубиками 6 мм',
            offers: { price: 105 },
            image: ['https://ir.ozone.ru/s3/multimedia-1/wc1200/dicer-main.jpg'],
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-pdp-1': JSON.stringify({
                sku: 3492958110,
                coverImage: 'https://ir.ozone.ru/s3/multimedia-1-z/wc1200/dicer-cover.jpg',
                images: [
                  { src: 'https://ir.ozone.ru/s3/multimedia-1-z/wc1200/dicer-cover.jpg' },
                  { src: 'https://ir.ozone.ru/s3/multimedia-1-y/wc1200/dicer-side.jpg' },
                ],
              }),
              'catalogMenu-185-default-1': JSON.stringify({
                categories: [
                  {
                    title: 'Одежда',
                    image: 'https://ir.ozone.ru/s3/multimedia-1/wc1200/dress-category.jpg',
                    url: '/category/odezhda/',
                  },
                  {
                    title: 'Электроника',
                    image: 'https://ir.ozone.ru/s3/searchteam-cdn/electro.png',
                  },
                ],
              }),
              'tileGridDesktop-recommend-1': JSON.stringify({
                items: [
                  {
                    tileImage: { items: [{ image: { link: 'https://ir.ozone.ru/s3/multimedia-9/wc1200/slicer-other.jpg' } }] },
                    action: { link: '/product/ovoreshchezka-1111111111/' },
                  },
                  {
                    coverImage: 'https://ir-20.ozonstatic.cn/s3/multimedia-1/wc1200/mop-other.jpg',
                    images: [{ src: 'https://ir.ozone.ru/s3/multimedia-8/wc1200/container-other.jpg' }],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <h1>Насадка для нарезки кубиками 6 мм</h1>
          <img src="https://ir.ozone.ru/s3/multimedia-7/wc1200/recommend-bottom.jpg" />
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/nasadka-dlya-narezki-kubikami-6-mm-3492958110/',
    );
    expect(product.imageUrls?.some((url) => /dicer-cover|dicer-side|dicer-main/i.test(url))).toBe(true);
    expect(
      product.imageUrls?.some((url) =>
        /slicer-other|mop-other|container-other|recommend-bottom|dress-category|searchteam-cdn|electro/i.test(url),
      ),
    ).toBe(false);
  });

  it('does not take warehouse size or weight from recommendation tiles', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webGallery-pdp-1': JSON.stringify({
            sku: 2974096117,
            images: [{ src: 'https://ir.ozone.ru/s3/multimedia-1/wc1200/heater-cover.jpg' }],
          }),
          'tileGridDesktop-recommend-1': JSON.stringify({
            items: [
              {
                sku: 1111111111,
                dimensions: { depth: 250, width: 100, height: 80, weight: 999 },
                tileImage: { items: [{ image: { link: 'https://ir.ozone.ru/s3/multimedia-9/wc1200/other.jpg' } }] },
              },
            ],
          }),
          'webDescription-1': JSON.stringify({
            richAnnotation: 'Спецификация:\nТолщина: около 0,5 мм\nРазмер: 10*22 см/20*40 см\n',
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '250')).toBe(false);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '999')).toBe(false);
    expect(product.imageUrls?.some((url) => /other\.jpg/i.test(url))).toBe(false);
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '400')).toBe(true);
  });

  it('keeps this-SKU tracking package when recommend tiles also have dimensions', () => {
    const product = extractOzonProductFromHtml(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        sku: '2974096117',
        name: 'Портативная электрогрелка',
        offers: { price: 990 },
      })}</script><script type="application/json">${JSON.stringify({
        widgetStates: {
          'webSale-1': JSON.stringify({
            cellTrackingInfo: {
              product: {
                sku: 2974096117,
                dimension: '211x46x24',
                weight: 49,
              },
            },
          }),
          'tileGridDesktop-recommend-1': JSON.stringify({
            items: [
              {
                sku: 1111111111,
                dimension: '250x100x80',
                weight: 999,
              },
            ],
          }),
        },
      })}</script></head><body><h1>Портативная электрогрелка</h1></body></html>`,
      'https://www.ozon.ru/product/portativnaya-elektrogrelka-2974096117/',
    );
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '211')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Ширина, мм' && item.value === '46')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Высота, мм' && item.value === '24')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '49')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Длина, мм' && item.value === '250')).toBe(false);
    expect(product.specs?.some((item) => item.name === 'Вес товара, г' && item.value === '999')).toBe(false);
  });

  it('keeps Толщина / Размер / Вес as separate labeled specs', () => {
    expect(
      parseLabeledDescriptionSpecs(
        'Описание:\nНебольшой размер.\nСпецификация:\nТолщина: около 0,5 мм\nРазмер: 10*22 см/20*40 см\nВес: 30 г\n',
      ),
    ).toEqual(
      expect.arrayContaining([
        { name: 'Толщина', value: 'около 0,5 мм' },
        { name: 'Размер', value: '10*22 см/20*40 см' },
        { name: 'Вес', value: '30 г' },
      ]),
    );
  });

  it('unwraps object-shaped characteristic titles and reads gallery img tags', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1547167821',
            name: 'Консервный нож Rondell RD-1877',
            offers: { price: 85 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webCharacteristics-1': JSON.stringify({
                characteristics: [
                  { title: { text: 'Тип' }, values: [{ text: 'Открывалка' }] },
                  { name: { content: 'Цвет' }, values: [{ text: 'Черный' }, {}, { text: 'серый' }] },
                  { title: { text: 'Длина, см' }, values: ['26'] },
                ],
              }),
              'webGallery-1': JSON.stringify({
                images: [
                  { src: '//ir.ozone.ru/s3/multimedia-1-z/wc750/1547167821-a.jpg' },
                  { src: 'https://ir-3.ozone.ru/s3/multimedia-1-y/c600/1547167821-b.jpg' },
                  { src: 'https://ir.ozone.ru/s3/multimedia-1-x/wc1200/1547167821-c.jpg' },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <h1>Консервный нож Rondell RD-1877</h1>
          <img src="//ir.ozone.ru/s3/multimedia-1-z/wc750/1547167821-a.jpg" />
          <img data-src="https://ir-3.ozone.ru/s3/multimedia-1-y/c600/1547167821-b.jpg" />
          <source srcset="https://ir.ozone.ru/s3/multimedia-1-x/wc1200/1547167821-c.jpg 2x" />
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/konservnyy-nozh-rondell-rd-1877-1547167821/',
    );
    expect(product.specs?.some((item) => item.name === '[object Object]')).toBe(false);
    expect(product.specs?.some((item) => item.name === 'Тип' && item.value === 'Открывалка')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Цвет' && /Черный/.test(item.value) && /серый/.test(item.value))).toBe(
      true,
    );
    expect(product.specs?.find((item) => item.name === 'Цвет')?.value).not.toMatch(/,\s*,/);
    expect(product.imageUrls?.some((url) => url.includes('1547167821-a.jpg'))).toBe(true);
    expect(product.imageUrls?.some((url) => url.includes('1547167821-b.jpg'))).toBe(true);
    expect(product.imageUrls?.some((url) => url.includes('1547167821-c.jpg'))).toBe(true);
  });

  it('keeps ozonstatic.cn multimedia urls used as the china cdn for gallery photos', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1866087431',
            name: 'Боул из нержавеющей стали с крышкой Pragma Sopdol, 5 л',
            offers: { price: 116 },
            image: ['https://ir-20.ozonstatic.cn/s3/multimedia-1-z/wc140/10326875500.jpg'],
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webGallery-1': JSON.stringify({
                images: [
                  { src: 'https://ir-20.ozonstatic.cn/s3/multimedia-1-y/wc140/10326875542.jpg' },
                  { src: 'https://ir-20.ozonstatic.cn/s3/multimedia-1-e/wc1200/10326876242.jpg' },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <h1>Боул из нержавеющей стали с крышкой Pragma Sopdol, 5 л</h1>
          <img src="https://ir-20.ozonstatic.cn/s3/multimedia-1-y/wc140/10326875542.jpg" />
          <img src="https://ir-20.ozonstatic.cn/s3/multimedia-1-e/wc1200/10326876242.jpg" />
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/boul-iz-nerzhaveyushchey-stali-s-kryshkoy-pragma-sopdol-5-l-yandeks-fabrika-1866087431/',
    );
    expect(product.imageUrls?.some((url) => /ozonstatic\.cn/i.test(url) && /10326875542/.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /10326876242/.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /wc140/i.test(url))).toBe(false);
    expect(product.imageUrls?.some((url) => /wc1200/i.test(url))).toBe(true);
  });

  it('reads textRs characteristic titles and composer-api webGallery coverImage', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1547167821',
            name: 'Консервный нож Rondell RD-1877',
            offers: { price: 85 },
          })}</script>
        </head>
        <body><h1>Консервный нож Rondell RD-1877</h1></body>
      </html>`;
    const composer = {
      widgetStates: {
        'webGallery-3121879-default-1': JSON.stringify({
          sku: 1547167821,
          coverImage: 'https://ir.ozone.ru/s3/multimedia-1-z/wc750/knife-cover.jpg',
          images: [
            { src: 'https://ir.ozone.ru/s3/multimedia-1-z/wc1200/knife-cover.jpg' },
            { image: 'https://ir.ozone.ru/s3/multimedia-1-y/knife-side.jpg' },
            { file_name: 'https://cdn1.ozone.ru/s3/multimedia-p/knife-box.jpg' },
            { image: { link: 'https://ir.ozone.ru/s3/multimedia-1-x/knife-detail.jpg' } },
          ],
        }),
        'webShortCharacteristics-1': JSON.stringify({
          characteristics: [
            { title: { textRs: [{ text: 'Тип' }] }, values: [{ text: 'Открывалка' }] },
            { title: { textRs: [{ content: 'Материал' }] }, values: [{ textRs: [{ text: 'Пластик' }] }] },
          ],
        }),
      },
    };
    const product = extractOzonProductFromHtml(
      html.replace('</head>', `<script type="application/json">${JSON.stringify(composer)}</script></head>`),
      'https://www.ozon.ru/product/konservnyy-nozh-rondell-rd-1877-1547167821/',
    );
    expect(product.specs?.some((item) => item.name === '[object Object]')).toBe(false);
    expect(product.specs?.some((item) => item.name === 'Тип' && item.value === 'Открывалка')).toBe(true);
    expect(product.specs?.some((item) => item.name === 'Материал' && item.value === 'Пластик')).toBe(true);
    expect(product.imageUrls?.some((url) => /knife-cover/i.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /knife-side/i.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /knife-box/i.test(url))).toBe(true);
    expect(product.imageUrls?.some((url) => /knife-detail/i.test(url))).toBe(true);
  });

  it('reads standalone aspect widget without wrapping aspects array', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Кофе Брауни 1 кг',
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                data: { title: 'Вес товара, г' },
                variants: [
                  { data: { text: '250' }, link: '/product/coffee-250-1111111111/' },
                  { data: { text: '1000' }, active: true, sku: 1085845200 },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Кофе Брауни 1 кг</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1085845200/');
    const weight = product.variants?.find((item) => item.name.includes('Вес'));
    expect(weight?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['250', '1000']));
    expect(product.skuOptions?.some((item) => item.skuId === '1111111111')).toBe(true);
  });

  it('reads ozon nested aspect data and flattens sibling skus', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1085845200',
            name: 'Кофе Брауни 1 кг',
            offers: { price: 2476 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-329087-default-1': JSON.stringify({
                aspects: [
                  {
                    data: { title: 'Вес товара, г' },
                    variants: [
                      { data: { text: '250' }, active: false, link: '/product/coffee-250-1111111111/' },
                      { data: { text: '1000' }, active: true, sku: 1085845200 },
                    ],
                  },
                  {
                    title: 'Название вкуса',
                    options: [
                      { searchableText: 'Брауни', selected: true, skuId: '1085845200' },
                      { searchableText: 'Бэрри', selected: false, href: '/product/coffee-berry-2222222222/' },
                      { searchableText: 'Кэнди', selected: false, url: '/product/coffee-candy-3333333333/' },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Вес товара, г</p>
            <a href="/product/coffee-250-1111111111/">250</a>
            <div>1000</div>
          </div>
          <h1>Кофе Брауни 1 кг</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1085845200/');
    const weight = product.variants?.find((item) => item.name.includes('Вес'));
    const flavor = product.variants?.find((item) => item.name.includes('вкуса'));
    expect(weight?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['250', '1000']));
    expect(flavor?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['Брауни', 'Бэрри', 'Кэнди']));
    const options = buildSkuOptions({
      ...product,
      skuId: product.skuId || '1085845200',
      name: product.name || 'coffee',
      sourceUrl: product.sourceUrl || 'https://www.ozon.ru/product/coffee-1085845200/',
      imageUrls: product.imageUrls || [],
      price: product.price || 2476,
      currency: 'RUB',
      stock: 1,
      specs: product.specs || [],
      salesCount: 0,
    });
    expect(options.some((item) => item.skuId === '1111111111' || item.sourceUrl?.includes('1111111111'))).toBe(true);
    expect(options.some((item) => item.skuId === '1085845200')).toBe(true);
  });

  it('reads sibling sku from product path instead of from_sku query', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1087433228',
            name: 'Кофе Брауни 250 г',
            offers: { price: 673 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    title: 'Название вкуса',
                    options: [
                      { searchableText: 'Брауни', selected: true, skuId: '1087433228' },
                      {
                        searchableText: 'Кэнди',
                        href: '/product/kofe-v-zernah-tasty-coffee-kendi-250-g-643792962/?from_sku=3004517624',
                      },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Кофе Брауни 250 г</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1087433228/');
    const candy = product.variants
      ?.find((item) => item.name.includes('вкуса'))
      ?.values.find((item) => item.value === 'Кэнди');
    expect(candy?.skuId).toBe('643792962');
    expect(product.skuOptions?.some((item) => item.skuId === '643792962')).toBe(true);
    expect(product.skuOptions?.every((item) => item.skuId !== '3004517624')).toBe(true);
  });

  it('keeps weight chips even when ozon appends unit price', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1087433228',
            name: 'Кофе Брауни 250 г',
            offers: { price: 673 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    data: { title: 'Вес товара, г' },
                    variants: [
                      { data: { text: '250 22,49 ¥ / 100 гр' }, active: true, sku: 1087433228 },
                      { data: { text: '1000 18,76 ¥ / 100 гр' }, link: '/product/coffee-1kg-715106535/' },
                    ],
                  },
                  {
                    title: 'Название вкуса',
                    options: [
                      { searchableText: 'Брауни', selected: true, skuId: '1087433228' },
                      { searchableText: 'Натти', href: '/product/coffee-natty-714928271/' },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Кофе Брауни 250 г</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1087433228/');
    const weight = product.variants?.find((item) => /вес/i.test(item.name));
    expect(weight?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['250', '1000']));
    expect(product.skuOptions?.some((item) => item.skuId === '715106535')).toBe(true);
    expect(product.skuOptions?.find((item) => item.skuId === '1087433228')?.options['Вес товара, г']).toBe('250');
  });

  it('keeps 1000g chips when ozon shows Выгода badge and nested link objects', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1087433228',
            name: 'Кофе в зернах Tasty Coffee Брауни, 250 г',
            offers: { price: 6777 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    aspectName: 'Вес товара, г',
                    aspectValues: [
                      { value: '250', isSelected: true, sku: 1087433228 },
                      {
                        value: 'Выгода 8%',
                        data: { text: '1000', subtitle: '22,57 ₽ / 100 гр' },
                        link: { href: '/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/' },
                      },
                    ],
                  },
                  {
                    title: 'Название вкуса',
                    options: [
                      { searchableText: 'Брауни', selected: true, skuId: '1087433228' },
                      { searchableText: 'Натти', href: '/product/coffee-natty-714928271/' },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Вес товара, г</p>
            <a href="/product/coffee-250-1087433228/">250</a>
            <button>Выгода 8% 1000 22,57 ₽ / 100 гр</button>
          </div>
          <h1>Кофе в зернах Tasty Coffee Брауни, 250 г</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1087433228/');
    const weight = product.variants?.find((item) => /вес/i.test(item.name));
    expect(weight?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['250', '1000']));
    expect(product.skuOptions?.some((item) => item.skuId === '1085845200')).toBe(true);
    expect(product.skuOptions?.find((item) => item.skuId === '1085845200')?.options['Вес товара, г']).toBe('1000');
  });

  it('reads 1000g from ozon rs chips and product path slugs', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1087433228',
            name: 'Кофе в зернах Tasty Coffee Брауни, 250 г',
            offers: { price: 6777 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    data: { title: 'Вес товара, г' },
                    rs: [
                      { key: '250', selected: true, sku: 1087433228 },
                      {
                        key: '1000',
                        title: { text: 'Выгода 8%' },
                        link: { href: '/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/' },
                      },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <a href="/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/">250</a>
            <a href="/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/">pack</a>
          </div>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/coffee-1087433228/');
    const weight = product.variants?.find((item) => /вес/i.test(item.name));
    expect(weight?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['250', '1000']));
    expect(product.skuOptions?.some((item) => item.skuId === '1085845200')).toBe(true);
  });

  it('does not treat recommendation carousels as weight or flavor variants', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1087433228',
            name: 'Кофе в зернах Tasty Coffee Брауни, 250 г',
            offers: { price: 6777 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    name: 'Вес товара, г',
                    values: [
                      { value: '250', isSelected: true, sku: 1087433228, link: '/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/' },
                      { value: '1000', link: '/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/' },
                    ],
                  },
                  {
                    name: 'Название вкуса',
                    values: [
                      { value: 'Брауни', isSelected: true, sku: 1087433228 },
                      { value: 'Бэрри', link: '/product/kofe-v-zernah-tasty-coffee-berri-250-g-231706603/' },
                    ],
                  },
                ],
              }),
              'skuGrid-1': JSON.stringify({
                title: 'Покупают вместе',
                values: [
                  { text: '1 кг', link: '/product/kofe-v-zernah-tasty-coffee-braziliya-serrado-1-kg-555555555/' },
                  { text: '250', link: '/product/kofe-v-zernah-milky-fusion-250-g-666666666/' },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Вес товара, г</p>
            <a href="/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/">250</a>
            <a href="/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/">1000</a>
            <p>Название вкуса</p>
            <a href="/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/">Брауни</a>
            <a href="/product/kofe-v-zernah-tasty-coffee-berri-250-g-231706603/">Бэрри</a>
          </div>
          <div data-widget="skuGrid">
            <a href="/product/kofe-v-zernah-tasty-coffee-braziliya-serrado-1-kg-555555555/">Бразилия 1 кг</a>
            <a href="/product/drip-kofe-lebo-drip-mix-48-sht-777777777/">drip</a>
          </div>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/',
    );
    expect(product.skuOptions?.some((item) => item.skuId === '1085845200')).toBe(true);
    expect(product.skuOptions?.some((item) => item.skuId === '231706603')).toBe(true);
    expect(product.skuOptions?.every((item) => item.skuId !== '555555555')).toBe(true);
    expect(product.skuOptions?.every((item) => item.skuId !== '666666666')).toBe(true);
    expect(product.skuOptions?.every((item) => item.skuId !== '777777777')).toBe(true);
  });

  it('reads color image swatches without text labels', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '266162238',
            name: 'Самоклеящийся держатель для швабры 2 ШТ, Белый',
            offers: { price: 1584 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    name: 'Цвет: белый',
                    values: [
                      {
                        ariaLabel: 'Белый',
                        image: 'https://ir.ozone.ru/s3/multimedia-1/wc50/white.jpg',
                        isSelected: true,
                        sku: 266162238,
                      },
                      {
                        alt: 'Серый',
                        preview: 'https://ir.ozone.ru/s3/multimedia-1/wc50/grey.jpg',
                        href: '/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-seryy-266162239/',
                      },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Цвет: белый</p>
            <a href="/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-belyy-266162238/">
              <img src="https://ir.ozone.ru/s3/multimedia-1/wc50/white.jpg" alt="Белый" />
            </a>
            <a href="/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-seryy-266162239/">
              <img src="https://ir.ozone.ru/s3/multimedia-1/wc50/grey.jpg" alt="Серый" />
            </a>
          </div>
          <h1>Самоклеящийся держатель для швабры 2 ШТ, Белый</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-belyy-266162238/',
    );
    const color = product.variants?.find((item) => /цвет/i.test(item.name));
    expect(color?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['Белый', 'Серый']));
    expect(color?.values.some((item) => item.imageUrls?.some((url) => url.includes('white.jpg')))).toBe(true);
    expect(product.skuOptions?.some((item) => item.skuId === '266162239')).toBe(true);
  });

  it('reads color image swatches from webAspects html when json is missing', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '266162238',
            name: 'Самоклеящийся держатель для швабры 2 ШТ, Белый',
            offers: { price: 1584 },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Цвет: белый</p>
            <a href="/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-belyy-266162238/">
              <img src="https://ir.ozone.ru/s3/multimedia-1/wc50/white.jpg" alt="Белый" />
            </a>
            <a href="/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-seryy-266162239/">
              <img src="https://ir.ozone.ru/s3/multimedia-1/wc50/grey.jpg" alt="Серый" />
            </a>
          </div>
          <h1>Самоклеящийся держатель для швабры 2 ШТ, Белый</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/samokleyashchiysya-derzhatel-dlya-shvabry-2-sht-belyy-266162238/',
    );
    const color = product.variants?.find((item) => /цвет/i.test(item.name));
    expect(color?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['Белый', 'Серый']));
    expect(product.skuOptions?.some((item) => item.skuId === '266162239')).toBe(true);
  });

  it('reads quantity chips as orderable skus instead of weight', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '1901992760',
            name: 'Крепление для картин / 4 штуки.',
            offers: { price: 673 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    name: 'Общее количество, шт',
                    values: [
                      { value: '4', isSelected: true, sku: 1901992760 },
                      { value: '10', link: '/product/kreplenie-dlya-kartin-10-shtuk-2850007823/' },
                      { value: '12', link: '/product/kreplenie-dlya-kartin-12-shtuk-2850009514/' },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body>
          <div data-widget="webAspects">
            <p>Общее количество, шт:</p>
            <button>4</button>
            <a href="/product/kreplenie-dlya-kartin-10-shtuk-2850007823/">10</a>
            <a href="/product/kreplenie-dlya-kartin-12-shtuk-2850009514/">12</a>
          </div>
          <h1>Крепление для картин / 4 штуки.</h1>
        </body>
      </html>`;
    const product = extractOzonProductFromHtml(
      html,
      'https://www.ozon.ru/product/kreplenie-dlya-kartin-podves-dlya-kartin-4-shtuki-1901992760/',
    );
    const qty = product.variants?.find((item) => /количест|штук/i.test(item.name));
    expect(qty?.values.map((item) => item.value)).toEqual(expect.arrayContaining(['4', '10', '12']));
    expect(product.variants?.some((item) => /вес/i.test(item.name))).toBe(false);
    expect(product.skuOptions?.map((item) => item.skuId)).toEqual(
      expect.arrayContaining(['1901992760', '2850007823', '2850009514']),
    );
  });

  it('keeps clothing size and color aspects on the same listing', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">${JSON.stringify({
            '@type': 'Product',
            sku: '4000001111',
            name: 'Блузка женская белая',
            offers: { price: 1990 },
          })}</script>
          <script type="application/json">${JSON.stringify({
            widgetStates: {
              'webAspects-1': JSON.stringify({
                aspects: [
                  {
                    name: 'Цвет',
                    values: [
                      { ariaLabel: 'Белый', image: 'https://ir.ozone.ru/s3/multimedia-1/wc50/w.jpg', sku: 4000001111, isSelected: true },
                      { ariaLabel: 'Чёрный', preview: 'https://ir.ozone.ru/s3/multimedia-1/wc50/b.jpg', href: '/product/bluzka-zhenskaya-chernaya-4000002222/' },
                    ],
                  },
                  {
                    name: 'Размер',
                    values: [
                      { value: 'S', sku: 4000001111, isSelected: true },
                      { value: 'M', link: '/product/bluzka-zhenskaya-belaya-m-4000003333/' },
                    ],
                  },
                ],
              }),
            },
          })}</script>
        </head>
        <body><h1>Блузка женская белая</h1></body>
      </html>`;
    const product = extractOzonProductFromHtml(html, 'https://www.ozon.ru/product/bluzka-zhenskaya-belaya-4000001111/');
    expect(product.variants?.map((item) => item.name)).toEqual(expect.arrayContaining(['Цвет', 'Размер']));
    expect(product.skuOptions?.map((item) => item.skuId)).toEqual(
      expect.arrayContaining(['4000001111', '4000002222', '4000003333']),
    );
  });

  it('fills orderable skus from chips when ingest only stored the current sku', () => {
    const filled = fillSkuOptionsFromVariants({
      skuId: '1901992760',
      name: 'Крепление для картин / 4 штуки.',
      sourceUrl: 'https://www.ozon.ru/product/kreplenie-1901992760/',
      price: 6.73,
      skuOptions: [
        {
          skuId: '1901992760',
          name: 'Крепление для картин / 4 штуки.',
          sourceUrl: 'https://www.ozon.ru/product/kreplenie-1901992760/',
          price: 6.73,
          imageUrls: [],
          options: { 'Общее количество, шт': '4' },
        },
      ],
      variants: [
        {
          name: 'Общее количество, шт',
          values: [
            { value: '4', skuId: '1901992760', selected: true },
            { value: '10', skuId: '2850007823', sourceUrl: 'https://www.ozon.ru/product/kreplenie-10-shtuk-2850007823/' },
            { value: '12', skuId: '2850009514', sourceUrl: 'https://www.ozon.ru/product/kreplenie-12-shtuk-2850009514/' },
          ],
        },
      ],
    });
    expect(filled.map((item) => item.skuId)).toEqual(expect.arrayContaining(['1901992760', '2850007823', '2850009514']));
    expect(filled.find((item) => item.skuId === '2850007823')?.options['Общее количество, шт']).toBe('10');
  });

  it('keeps only the page main sku and strips sibling sku ids', () => {
    const kept = keepMainSkuOnly({
      skuId: '1901992760',
      name: 'Крепление для картин / 4 штуки.',
      sourceUrl: 'https://www.ozon.ru/product/kreplenie-1901992760/?at=1',
      price: 6.73,
      currency: 'RUB',
      stock: 1,
      specs: [],
      salesCount: 0,
      imageUrls: ['https://ir.ozone.ru/cover.jpg'],
      skuOptions: [
        {
          skuId: '1901992760',
          name: 'Крепление для картин / 4 штуки.',
          sourceUrl: 'https://www.ozon.ru/product/kreplenie-1901992760/',
          price: 6.73,
          imageUrls: [],
          options: { 'Общее количество, шт': '4' },
        },
        {
          skuId: '2850007823',
          name: 'Крепление для картин / 10 штук.',
          sourceUrl: 'https://www.ozon.ru/product/kreplenie-10-shtuk-2850007823/',
          price: 8.1,
          imageUrls: [],
          options: { 'Общее количество, шт': '10' },
        },
      ],
      variants: [
        {
          name: 'Общее количество, шт',
          values: [
            { value: '4', skuId: '1901992760', selected: true },
            { value: '10', skuId: '2850007823', sourceUrl: 'https://www.ozon.ru/product/kreplenie-10-shtuk-2850007823/' },
            { value: '12', skuId: '2850009514', sourceUrl: 'https://www.ozon.ru/product/kreplenie-12-shtuk-2850009514/' },
          ],
        },
      ],
    });
    expect(kept.skuOptions?.map((item) => item.skuId)).toEqual(['1901992760']);
    expect(kept.skuOptions?.[0]?.sourceUrl).toBe('https://www.ozon.ru/product/kreplenie-1901992760/');
    expect(kept.variants?.[0]?.values.map((item) => item.skuId)).toEqual(['1901992760', undefined, undefined]);
    expect(kept.variants?.[0]?.values[1]?.sourceUrl).toBeUndefined();
  });

  it('maps each sku to its own flavor instead of copying the first chip', () => {
    const aligned = alignSkuOptions(
      [
        {
          skuId: '714928271',
          name: 'Кофе в зернах Tasty Coffee Натти, 250 г',
          sourceUrl: 'https://www.ozon.ru/product/natti-714928271/',
          price: 62,
          imageUrls: [],
          options: { 'Название вкуса': 'Брауни' },
        },
        {
          skuId: '231706603',
          name: 'Кофе в зернах Tasty Coffee Бэрри, 250 г',
          sourceUrl: 'https://www.ozon.ru/product/berri-231706603/',
          price: 65,
          imageUrls: [],
          options: { 'Название вкуса': 'Брауни' },
        },
      ],
      [
        {
          name: 'Название вкуса',
          values: [
            { value: 'Брауни', skuId: '1087433228' },
            { value: 'Бэрри', skuId: '231706603' },
            { value: 'Натти', skuId: '714928271' },
          ],
        },
      ],
    );
    expect(aligned.find((item) => item.skuId === '714928271')?.options['Название вкуса']).toBe('Натти');
    expect(aligned.find((item) => item.skuId === '231706603')?.options['Название вкуса']).toBe('Бэрри');
    expect(aligned.find((item) => item.skuId === '714928271')?.options['Вес товара, г']).toBe('250');
  });
});

describe('ozon product family', () => {
  it('groups 250g and 1kg titles of the same listing', () => {
    const flavors = {
      name: 'Название вкуса',
      values: [{ value: 'Натти' }, { value: 'Брауни' }],
    };
    expect(
      productFamilyKey('Кофе в зернах Tasty Coffee Натти, 250 г', 'Tasty Coffee', [flavors]),
    ).toBe(productFamilyKey('Кофе в зернах Tasty Coffee Брауни, 1 кг', 'Tasty Coffee', [flavors]));
    expect(
      isSameOzonFamily(
        { skuId: '714928271', name: 'Кофе в зернах Tasty Coffee Натти, 250 г', brand: 'Tasty Coffee' },
        { skuId: '1085845200', name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг', brand: 'Tasty Coffee' },
      ),
    ).toBe(true);
    expect(inferWeightOption('', 'https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/')).toBe(
      '1000',
    );
    expect(
      ozonListingSlugFamily('https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-250-g-1087433228/'),
    ).toBe(ozonListingSlugFamily('https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-berri-250-g-231706603/'));
    expect(
      ozonListingSlugFamily('https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-brauni-1-kg-1085845200/'),
    ).not.toBe(
      ozonListingSlugFamily('https://www.ozon.ru/product/kofe-v-zernah-tasty-coffee-braziliya-serrado-1-kg-555555555/'),
    );
    const combined = combineFamilyListings([
      {
        skuId: '1087433228',
        name: 'Кофе в зернах Tasty Coffee Брауни, 250 г',
        sourceUrl: 'https://www.ozon.ru/product/coffee-1087433228/',
        price: 67,
        skuOptions: [
          {
            skuId: '1087433228',
            name: 'Кофе в зернах Tasty Coffee Брауни, 250 г',
            sourceUrl: 'https://www.ozon.ru/product/coffee-1087433228/',
            price: 67,
            imageUrls: [],
            options: { 'Название вкуса': 'Брауни', 'Вес товара, г': '250' },
          },
        ],
      },
      {
        skuId: '1085845200',
        name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг',
        sourceUrl: 'https://www.ozon.ru/product/coffee-1085845200/',
        price: 247,
      },
    ]);
    expect(combined.skuOptions.map((item) => item.skuId)).toEqual(expect.arrayContaining(['1087433228', '1085845200']));
    expect(combined.variants.find((item) => /вес/i.test(item.name))?.values.map((item) => item.value)).toEqual(
      expect.arrayContaining(['250', '1000']),
    );
  });
});

describe('product review queue', () => {
  it('keeps chrome-ingested crawled products visible before AI finishes', () => {
    expect(PRODUCT_REVIEW_QUEUE_STATUSES).toEqual(
      expect.arrayContaining(['CRAWLED', 'AI_PENDING', 'AI_DONE', 'REVIEW_PENDING']),
    );
  });
});

describe('withRetry', () => {
  it('retries failed operations until success', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('fail');
        return 'ok';
      },
      { maxRetry: 3, backoffMs: () => 0 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry captcha errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new CaptchaDetectedError();
        },
        { maxRetry: 3, backoffMs: () => 0 },
      ),
    ).rejects.toBeInstanceOf(CaptchaDetectedError);
    expect(attempts).toBe(1);
  });
});

describe('rule-based AI scoring', () => {
  it('recommends a healthy product', () => {
    const result = scoreProduct({
      skuId: '1',
      name: 'ok',
      sourceUrl: 'https://x',
      imageUrls: [],
      price: 1200,
      currency: 'RUB',
      stock: 20,
      specs: [],
      rating: 4.6,
      salesCount: 800,
    });
    expect(result.recommended).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('rejects zero stock', () => {
    const result = scoreProduct({
      skuId: '2',
      name: 'empty',
      sourceUrl: 'https://x',
      imageUrls: [],
      price: 1200,
      currency: 'RUB',
      stock: 0,
      specs: [],
      rating: 4.8,
      salesCount: 900,
    });
    expect(result.recommended).toBe(false);
    expect(result.riskPoints.some((item) => item.includes('库存'))).toBe(true);
  });

  it('parses nested product JSON from the selection prompt', async () => {
    const { RuleBasedLlmProvider, buildSelectionPrompt } = await import('@aiecom/llm-core');
    const provider = new RuleBasedLlmProvider();
    const raw = await provider.completeJson(
      buildSelectionPrompt({
        skuId: '800000000',
        name: 'nested',
        sourceUrl: 'https://x',
        imageUrls: [],
        price: 1200,
        currency: 'RUB',
        stock: 20,
        specs: [{ name: '品牌', value: 'MockBrand' }],
        rating: 4.6,
        salesCount: 800,
      }),
    );
    expect(raw).toMatchObject({ recommended: true, profitCurrency: 'RUB' });
  });
});
