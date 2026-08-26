import {
  buildSubjectQueries,
  buildWbDescription,
  buildWbTitle,
  buildWbUploadPayload,
  buildWbVendorCode,
  collectImageUrls,
  existingCardHasForbiddenSizes,
  isWbDraftRecreateError,
  isWbSizedDraft,
  isWbVendorCodeConflict,
  mapWbCharacteristics,
  mapWbDimensions,
  mapWbSizes,
  mergeWbCardSizes,
  parseOzonSkuFromVendorCode,
  pickWbSubject,
  resolveWbBrand,
  skuTechSize,
  stripWbForbiddenChars,
} from '@aiecom/platform-core';

describe('wb listing mapper', () => {
  it('maps Ozon SKU into a stable WB vendor code without OZ prefix', () => {
    expect(buildWbVendorCode('3640849492')).toBe('3640849492');
    expect(buildWbVendorCode('OZ3640849492')).toBe('3640849492');
    expect(parseOzonSkuFromVendorCode('OZ3640849492')).toBe('3640849492');
    expect(parseOzonSkuFromVendorCode('3640849492')).toBe('3640849492');
    expect(isWbVendorCodeConflict('Unexpected the specified card\'s vendor code is used in other cards')).toBe(true);
    expect(isWbVendorCodeConflict('Wildberries HTTP 429')).toBe(false);
  });

  it('does not use brand crumbs like Zarina as WB subject queries', () => {
    const queries = buildSubjectQueries('Одежда / Женская одежда / Блузы и рубашки / Zarina', 'Блузка Zarina');
    expect(queries[0]).toBe('Блузы и рубашки');
    expect(queries.join(' ')).not.toMatch(/Zarina/i);
  });

  it('keeps household category crumbs instead of treating them as brands', () => {
    const queries = buildSubjectQueries(
      'Дом и сад / Хозяйственные товары / Инвентарь для уборки / Аксессуары для инвентаря',
    );
    expect(queries.join(' ')).toMatch(/Хозяйственные товары/i);
    expect(queries).toEqual(expect.arrayContaining(['Инвентарь для уборки', 'Инвентарь', 'уборки']));
    expect(
      pickWbSubject(
        [
          { subjectID: 10, subjectName: 'Садовая мебель', parentName: 'Дом и сад' },
          { subjectID: 88, subjectName: 'Инвентарь для уборки', parentName: 'Хозяйственные товары' },
        ],
        queries,
      )?.subjectID,
    ).toBe(88);
  });

  it('strips unauthorized brand from title and keeps Ozon SKU in description', () => {
    expect(buildWbTitle('Блузка Zarina', null, 'Одежда / Блузы и рубашки / Zarina')).not.toMatch(/Zarina/i);
    const description = buildWbDescription('', [], { skuId: '3640849492', name: 'Блузка', categoryPath: 'Одежда / Блузы', colors: ['черный'] });
    expect(description).toContain('3640849492');
    expect(description).not.toContain('OZ3640849492');
    expect(description.length).toBeGreaterThanOrEqual(1000);
    expect(description.length).toBeLessThanOrEqual(1900);
  });

  it('drops Ozon thumbnail URLs and keeps full-size images', () => {
    const urls = collectImageUrls({
      skuId: '1',
      name: 'Item',
      price: 10,
      imageUrls: [
        'https://ir-20.ozone.ru/s3/multimedia-1-z/c600/9290778407.jpg',
        'https://ir-20.ozone.ru/s3/multimedia-1-z/9290778407.jpg',
      ],
      specs: [],
      skuOptions: [],
    });
    expect(urls).toEqual(['https://ir-20.ozone.ru/s3/multimedia-1-z/9290778407.jpg']);
    expect(
      collectImageUrls({
        skuId: '1',
        name: 'Item',
        price: 10,
        imageUrls: ['https://ir-20.ozone.ru/s3/multimedia-1-z/c600/9290778408.jpg'],
        specs: [],
        skuOptions: [],
      }),
    ).toEqual(['https://ir-20.ozone.ru/s3/multimedia-1-z/9290778408.jpg']);
  });

  it('strips emoji because card upload rejects them', () => {
    expect(stripWbForbiddenChars('Shirt 😊')).toBe('Shirt');
    expect(buildWbTitle('Premium Shirt 😊')).toBe('Premium Shirt');
  });

  it('picks the closest WB subject from category path queries', () => {
    const queries = buildSubjectQueries('Одежда / Женщинам / Блузки', 'Silk blouse');
    expect(queries[0]).toBe('Блузки');
    const subject = pickWbSubject(
      [
        { subjectID: 1, subjectName: 'Футболки', parentName: 'Одежда' },
        { subjectID: 55, subjectName: 'Блузки', parentName: 'Женщинам' },
      ],
      queries,
    );
    expect(subject?.subjectID).toBe(55);
  });

  it('matches blouse subjects from Ozon crumbs like Блузы и рубашки', () => {
    const queries = buildSubjectQueries('Одежда / Женская одежда / Блузы и рубашки / Zarina');
    expect(queries).toEqual(expect.arrayContaining(['Блузы и рубашки', 'Блузы', 'рубашки']));
    const subject = pickWbSubject(
      [
        { subjectID: 9, subjectName: 'Одежда для кукол', parentName: 'Игрушки' },
        { subjectID: 55, subjectName: 'Блузки', parentName: 'Женщинам' },
      ],
      queries,
    );
    expect(subject?.subjectID).toBe(55);
  });

  it('parses package dimensions and weight from specs', () => {
    expect(
      mapWbDimensions([
        { name: 'Длина', value: '25 см' },
        { name: 'Ширина', value: '180 mm' },
        { name: 'Высота', value: '10' },
        { name: 'Вес', value: '450 г' },
      ]),
    ).toEqual({
      length: 25,
      width: 18,
      height: 10,
      weightBrutto: 0.45,
    });
  });

  it('converts mm/g when the unit lives in the spec name', () => {
    expect(
      mapWbDimensions([
        { name: 'Длина, мм', value: '400' },
        { name: 'Ширина, мм', value: '300' },
        { name: 'Высота, мм', value: '20' },
        { name: 'Вес товара, г', value: '450' },
      ]),
    ).toEqual({
      length: 40,
      width: 30,
      height: 2,
      weightBrutto: 0.5,
    });
  });

  it('reads 30x40 cm from the product title instead of 20x15x10 defaults', () => {
    expect(
      mapWbDimensions([], {
        name: 'Коврик для сушки посуды, 30x40 см, желтый',
      }),
    ).toMatchObject({
      length: 40,
      width: 30,
      height: 10,
    });
  });

  it('parses combined package габариты', () => {
    expect(
      mapWbDimensions([{ name: 'Габариты товара', value: '200x150x50 мм' }]),
    ).toEqual({
      length: 20,
      width: 15,
      height: 5,
      weightBrutto: 0.3,
    });
  });

  it('uses sku option / title weight so 1kg goods are not listed as 0.3kg', () => {
    expect(
      mapWbDimensions([], {
        name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг',
        skuOptions: [
          { name: 'Vanilla 1000', options: { 'Вес товара, г': '1000', Вкус: 'ваниль' } },
        ],
      }).weightBrutto,
    ).toBeGreaterThanOrEqual(1);
  });

  it('uses a single large size in the title as package length', () => {
    expect(mapWbDimensions([], { name: 'Швабра для пола 120 см' }).length).toBeGreaterThanOrEqual(120);
  });

  it('creates one WB size per sku option and maps color/brand characteristics', () => {
    const draft = {
      skuId: '111',
      name: 'Silk blouse',
      brand: 'Tasty',
      categoryPath: 'Одежда / Блузки',
      price: 1990,
      imageUrls: ['https://cdn.example/a.jpg'],
      specs: [
        { name: 'Цвет', value: 'белый' },
        { name: 'Состав', value: 'шелк' },
      ],
      skuOptions: [
        { skuId: '111-s', name: 'S', price: 1990, options: { Размер: 'S' } },
        { skuId: '111-m', name: 'M', price: 2090, options: { Размер: 'M' } },
      ],
    };
    const sizes = mapWbSizes(draft, ['123', '456'], { sized: true });
    expect(sizes.map((item) => item.techSize)).toEqual(['S', 'M']);
    expect(sizes[1].skus).toEqual(['456']);

    const mapped = mapWbCharacteristics(
      [
        { charcID: 12, name: 'Цвет', required: true },
        { charcID: 30, name: 'Бренд', required: true },
        { charcID: 40, name: 'Состав', required: false },
        { charcID: 50, name: 'Размер', required: false },
        { charcID: 60, name: 'ТН ВЭД', required: true },
        { charcID: 70, name: 'Артикул производителя', required: false },
      ],
      draft,
      { colors: [{ name: 'белый' }, { name: 'черный' }], tnved: ['6206', '6206400000'] },
      { brand: 'NoName' },
    );
    expect(mapped.missingRequired).toEqual([]);
    expect(mapped.characteristics).toEqual(
      expect.arrayContaining([
        { id: 12, value: ['белый'] },
        { id: 30, value: ['NoName'] },
        { id: 60, value: ['6206400000'] },
        { id: 70, value: ['111'] },
      ]),
    );

    const payload = buildWbUploadPayload({
      subject: { subjectID: 55, subjectName: 'Блузки' },
      draft,
      vendorCode: '111',
      barcodes: ['123', '456'],
      characteristics: mapped.characteristics,
      brand: 'NoName',
      sized: true,
    });
    expect(payload[0].subjectID).toBe(55);
    expect(payload[0].variants[0].vendorCode).toBe('111');
    expect(payload[0].variants[0].sizes).toHaveLength(2);
    expect(payload[0].variants[0].title).toBe('Silk blouse');
    expect(payload[0].variants[0].description.length).toBeGreaterThanOrEqual(1000);
    expect(payload[0].variants[0].description.length).toBeLessThanOrEqual(1900);
    expect(payload[0].variants[0].brand).toBe('NoName');
  });

  it('creates one WB size for each flavor/weight SKU, not only the main skuId', () => {
    const draft = {
      skuId: '1087433228',
      name: 'Coffee 250g',
      price: 390,
      imageUrls: [],
      specs: [],
      skuOptions: [
        { skuId: '1087433228', name: 'Vanilla 250', price: 390, options: { 'Вес товара, г': '250', Вкус: 'ваниль' } },
        { skuId: '1085845200', name: 'Vanilla 1000', price: 990, options: { 'Вес товара, г': '1000', Вкус: 'ваниль' } },
        { skuId: '231706603', name: 'Chocolate 250', price: 410, options: { 'Вес товара, г': '250', Вкус: 'шоколад' } },
      ],
    };
    expect(isWbSizedDraft(draft)).toBe(false);
    const sizes = mapWbSizes(draft, ['a', 'b', 'c']);
    expect(sizes).toEqual([{ techSize: '0', price: 390, skus: ['a'] }]);
    expect(skuTechSize(draft.skuOptions[0])).toBe('250 / ваниль');
    const payload = buildWbUploadPayload({
      subject: { subjectID: 1, subjectName: 'Кофе', isSize: false },
      draft,
      vendorCode: '1087433228',
      barcodes: ['a'],
      characteristics: [],
      brand: 'Acme',
      sized: false,
    });
    expect(payload[0].variants[0].brand).toBe('Acme');
    expect(payload[0].variants[0].sizes).toEqual([{ skus: ['a'], price: 390 }]);
    expect(payload[0].variants[0].sizes[0]).not.toHaveProperty('techSize');
    expect(payload[0].variants[0].sizes[0]).not.toHaveProperty('wbSize');
  });

  it('keeps a single non-spec SKU as techSize 0', () => {
    expect(
      mapWbSizes(
        { skuId: '1', name: 'Item', price: 10, imageUrls: [], specs: [], skuOptions: [] },
        ['111'],
      ),
    ).toEqual([{ techSize: '0', price: 10, skus: ['111'] }]);
  });

  it('merges newly listed SKU sizes onto an existing WB card', () => {
    const merged = mergeWbCardSizes(
      [
        { techSize: '250 / ваниль', price: 390, skus: [] },
        { techSize: '1000 / ваниль', price: 990, skus: [] },
      ],
      [{ chrtID: 9, techSize: '250 / ваниль', skus: ['old'] }],
      ['new-barcode'],
    );
    expect(merged).toEqual([
      { chrtID: 9, techSize: '250 / ваниль', wbSize: undefined, skus: ['old'], price: 390 },
      { techSize: '1000 / ваниль', wbSize: undefined, skus: ['new-barcode'], price: 990 },
    ]);
  });

  it('reports missing required characteristics', () => {
    const mapped = mapWbCharacteristics(
      [{ charcID: 1, name: 'Цвет', required: true }],
      {
        skuId: '1',
        name: 'Item',
        price: 10,
        imageUrls: [],
        specs: [],
        skuOptions: [],
      },
    );
    expect(mapped.missingRequired).toEqual(['Цвет']);
  });

  it('does not treat Ozon size options as WB sizes unless the subject is a clothing category', () => {
    const household = {
      skuId: '1',
      name: 'Mop',
      categoryPath: 'Дом и сад / Хозяйственные товары / Инвентарь для уборки',
      price: 10,
      imageUrls: [],
      specs: [],
      skuOptions: [{ skuId: '1', name: 'Mop', price: 10, options: { Размер: '120 см' } }],
    };
    expect(isWbSizedDraft(household)).toBe(false);
    expect(isWbSizedDraft(household, { isSize: false, subjectName: 'Инвентарь для уборки' })).toBe(false);
    expect(
      isWbSizedDraft(
        {
          skuId: '2',
          name: 'Blouse',
          categoryPath: 'Одежда / Блузки',
          price: 10,
          imageUrls: [],
          specs: [],
          skuOptions: [{ skuId: '2', name: 'S', price: 10, options: { Размер: 'S' } }],
        },
        { subjectName: 'Блузки', parentName: 'Женщинам' },
      ),
    ).toBe(true);
  });

  it('passes crawled or generic brand through for WB to accept or reject', () => {
    expect(resolveWbBrand({ preferred: 'MyShop', directory: ['NoName', 'MyShop'] })).toBe('MyShop');
    expect(resolveWbBrand({ preferred: '', crawled: 'Tasty Coffee', directory: ['Tasty Coffee'] })).toBe(
      'Tasty Coffee',
    );
    expect(resolveWbBrand({ preferred: '', crawled: 'Tasty Coffee', directory: [] })).toBe('Tasty Coffee');
    expect(resolveWbBrand({ preferred: '', crawled: 'Tasty Coffee', directory: ['Adidas'] })).toBe(
      'Tasty Coffee',
    );
    expect(resolveWbBrand({ preferred: '', crawled: 'NoName', directory: ['Adidas'] })).toBe('NoName');
    expect(resolveWbBrand({ preferred: '', directory: ['Нет бренда', 'Adidas'] })).toBe('Нет бренда');
    expect(resolveWbBrand({ preferred: '', directory: [] })).toBe('NoName');
    expect(isWbDraftRecreateError('Бренд «NoName» не найден')).toBe(true);
    expect(
      isWbDraftRecreateError(
        'Недопустимо указывать Размер и Рос.Размер для безразмерного товара',
      ),
    ).toBe(true);
    expect(existingCardHasForbiddenSizes([{ techSize: '250 / ваниль', wbSize: '250 / ваниль' }])).toBe(true);
    expect(existingCardHasForbiddenSizes([{ techSize: '0' }])).toBe(false);
  });
});
