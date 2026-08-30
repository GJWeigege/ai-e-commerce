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
  looksLikeApparelSizeValue,
  looksLikeOneSizeValue,
  mapWbCharacteristics,
  mapWbDimensions,
  mapWbSizes,
  mergeWbCardSizes,
  normalizeOzonCategoryKey,
  parseOzonSkuFromVendorCode,
  pickWbSubject,
  planWbCardRepair,
  compactWbBrandDirectory,
  resolveWbBrand,
  WB_BRAND_DIRECTORY_CAP,
  resolveWbColorValue,
  resolveWbSizedFlag,
  sanitizeWbColorValue,
  skuTechSize,
  stripWbForbiddenChars,
  WB_DESCRIPTION_MAX,
  WbCardRepairState,
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

  it('maps Ozon pillow crumbs onto WB подушки instead of generic bedding', () => {
    const queries = buildSubjectQueries(
      'Дом и сад / Домашний текстиль / Постельное бельё',
      'Подушка 50x70 лебяжий пух',
    );
    expect(queries.join(' ')).toMatch(/подушк/i);
    expect(
      pickWbSubject(
        [
          { subjectID: 10, subjectName: 'Комплекты постельного белья', parentName: 'Домашний текстиль' },
          { subjectID: 4459, subjectName: 'Подушки', parentName: 'Домашний текстиль' },
          { subjectID: 90, subjectName: 'Пледы', parentName: 'Текстиль для дома' },
        ],
        queries,
      )?.subjectID,
    ).toBe(4459);
  });

  it('maps Ozon heated-textile crumbs and product name onto WB subjects', () => {
    const queries = buildSubjectQueries(
      'Дом и сад / Текстиль с электроподогревом',
      'Электрогрелка портативная 150x200',
    );
    expect(queries.join(' ')).toMatch(/электрогрелк/i);
    expect(queries.join(' ')).toMatch(/для дома|дом/i);
    expect(
      pickWbSubject(
        [
          { subjectID: 12, subjectName: 'Садовая мебель', parentName: 'Сад и дача' },
          { subjectID: 77, subjectName: 'Электрогрелки', parentName: 'Для дома' },
          { subjectID: 90, subjectName: 'Пледы', parentName: 'Текстиль для дома' },
        ],
        queries,
      )?.subjectID,
    ).toBe(77);
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
      length: 27,
      width: 20,
      height: 12,
      weightBrutto: 0.55,
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
      length: 42,
      width: 32,
      height: 4,
      weightBrutto: 0.55,
    });
  });

  it('reads 30x40 cm from the product title instead of filling defaults', () => {
    expect(
      mapWbDimensions([], {
        name: 'Коврик для сушки посуды, 30x40 см, желтый',
      }),
    ).toEqual({
      length: 42,
      width: 32,
    });
  });

  it('does not treat clothing letter Размер as warehouse package', () => {
    expect(mapWbDimensions([{ name: 'Размер', value: 'M' }])).toEqual({});
    expect(mapWbDimensions([], { description: 'Размер: 10*22 см/20*40 см' })).toEqual({});
  });

  it('maps physical Размер 2D plus thickness and description Вес to warehouse package', () => {
    expect(
      mapWbDimensions([
        { name: 'Размер', value: '10*22 см/20*40 см' },
        { name: 'Толщина', value: 'около 0,5 мм' },
      ]),
    ).toEqual({
      length: 42,
      width: 22,
      height: 3,
    });
    expect(mapWbDimensions([{ name: 'Вес', value: '30 г' }])).toEqual({
      weightBrutto: 0.13,
    });
  });

  it('parses combined package габариты without inventing weight', () => {
    expect(
      mapWbDimensions([{ name: 'Габариты товара', value: '200x150x50 мм' }]),
    ).toEqual({
      length: 22,
      width: 17,
      height: 7,
    });
  });

  it('maps cookware diameter plus wall height to a square package and does not invent weight', () => {
    expect(
      mapWbDimensions([
        { name: 'Диаметр дна, см', value: '28' },
        { name: 'Высота стенки, см', value: '5' },
        { name: 'Размер крышки, см', value: '28' },
        { name: 'Толщина стенок, мм', value: '1.8' },
        { name: 'Упаковка', value: 'Коробка' },
      ]),
    ).toEqual({
      length: 30,
      width: 30,
      height: 7,
    });
  });

  it('leaves dimensions blank when size and weight are missing', () => {
    expect(mapWbDimensions([], { name: 'Silk blouse' })).toEqual({});
  });

  it('keeps explicit brutto without adding packing allowance', () => {
    expect(mapWbDimensions([{ name: 'Вес брутто, кг', value: '0.45' }])).toEqual({
      weightBrutto: 0.45,
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
    ).toBeGreaterThanOrEqual(1.2);
  });

  it('uses a single large size in the title as package length', () => {
    expect(mapWbDimensions([], { name: 'Швабра для пола 120 см' }).length).toBeGreaterThanOrEqual(120);
  });

  it('does not let marketing 40cm in the title override ozon package 211x46x24mm', () => {
    expect(
      mapWbDimensions(
        [
          { name: 'Длина, мм', value: '211' },
          { name: 'Ширина, мм', value: '46' },
          { name: 'Высота, мм', value: '24' },
          { name: 'Вес товара, г', value: '49' },
        ],
        { name: 'Портативная электрогрелка 40cm', description: 'нагреватель 40x20 см кабель 120cm' },
      ),
    ).toEqual({
      length: 24,
      width: 7,
      height: 5,
      weightBrutto: 0.15,
    });
  });

  it('does not let PDP Габариты 10*22 см override logistics 211x46x24mm', () => {
    expect(
      mapWbDimensions(
        [
          { name: 'Длина, мм', value: '211' },
          { name: 'Ширина, мм', value: '46' },
          { name: 'Высота, мм', value: '24' },
          { name: 'Вес товара, г', value: '49' },
          { name: 'Габариты', value: '10*22 см' },
        ],
        { name: 'Портативная электрогрелка', description: 'Размер: 10*22 см/20*40 см' },
      ),
    ).toEqual({
      length: 24,
      width: 7,
      height: 5,
      weightBrutto: 0.15,
    });
  });

  it('does not add packing allowance twice when specs already carry package edges', () => {
    expect(
      mapWbDimensions([
        { name: 'Длина упаковки, мм', value: '250' },
        { name: 'Ширина упаковки, мм', value: '180' },
        { name: 'Высота упаковки, мм', value: '100' },
        { name: 'Вес брутто, кг', value: '0.45' },
      ]),
    ).toEqual({
      length: 25,
      width: 18,
      height: 10,
      weightBrutto: 0.45,
    });
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
    expect(payload[0].variants[0].dimensions).toBeUndefined();
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
      [{ charcID: 1, name: 'Комплектация', required: true }],
      {
        skuId: '1',
        name: 'Item',
        price: 10,
        imageUrls: [],
        specs: [],
        skuOptions: [],
      },
    );
    expect(mapped.missingRequired).toEqual(['Комплектация']);
  });

  it('fills a required color with a safe fallback instead of failing the card', () => {
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
    expect(mapped.missingRequired).toEqual([]);
    expect(mapped.characteristics).toEqual([{ id: 1, value: ['разноцветный'] }]);
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

  it('does not submit an unregistered Ozon seller brand to WB', () => {
    expect(resolveWbBrand({ preferred: 'MyShop', directory: ['NoName', 'MyShop'] })).toBe('MyShop');
    expect(resolveWbBrand({ preferred: '', crawled: 'Tasty Coffee', directory: ['Tasty Coffee'] })).toBe(
      'Tasty Coffee',
    );
    // Ozon 卖家名不在 WB 备案：Бренд «СТУПНИКОВА» не найден
    expect(resolveWbBrand({ preferred: '', crawled: 'СТУПНИКОВА', directory: [] })).toBe('NoName');
    expect(resolveWbBrand({ preferred: '', crawled: 'СТУПНИКОВА', directory: ['Adidas', 'Нет бренда'] })).toBe(
      'Нет бренда',
    );
    expect(resolveWbBrand({ preferred: '', crawled: 'Tasty Coffee', directory: ['Adidas'] })).toBe('NoName');
    expect(resolveWbBrand({ preferred: '', crawled: 'NoName', directory: ['Adidas'] })).toBe('NoName');
    expect(resolveWbBrand({ preferred: '', directory: ['Нет бренда', 'Adidas'] })).toBe('Нет бренда');
    expect(resolveWbBrand({ preferred: '', directory: [] })).toBe('NoName');
    expect(resolveWbBrand({ preferred: 'MyShop', crawled: 'СТУПНИКОВА', directory: [] })).toBe('MyShop');
    expect(resolveWbBrand({ preferred: 'MyShop', directory: Array.from({ length: 5000 }, (_, i) => `Brand${i}`) })).toBe(
      'MyShop',
    );

    const compacted = compactWbBrandDirectory(
      ['Adidas', ...Array.from({ length: WB_BRAND_DIRECTORY_CAP + 200 }, (_, i) => `Brand${i}`), 'Нет бренда'],
      ['Brand2600'],
    );
    expect(compacted[0]).toBe('Нет бренда');
    expect(compacted).toContain('Brand2600');
    expect(compacted.length).toBeLessThanOrEqual(WB_BRAND_DIRECTORY_CAP);
    expect(isWbDraftRecreateError('Бренд «NoName» не найден')).toBe(true);
    expect(
      isWbDraftRecreateError(
        'Недопустимо указывать Размер и Рос.Размер для безразмерного товара',
      ),
    ).toBe(true);
    expect(existingCardHasForbiddenSizes([{ techSize: '250 / ваниль', wbSize: '250 / ваниль' }])).toBe(true);
    expect(existingCardHasForbiddenSizes([{ techSize: '0' }])).toBe(false);
  });

  it('treats bedding subjects as sizeless even when Ozon crumbs and options look like clothing sizes', () => {
    // 实际拒卡场景：枕头挂在「Постельное бельё」下，Ozon 规格里的 Размер 是 50x70 物理尺寸
    const pillow = {
      skuId: '9001',
      name: 'Подушка 50x70 лебяжий пух',
      categoryPath: 'Дом и сад / Домашний текстиль / Постельное бельё',
      price: 1200,
      imageUrls: [],
      specs: [],
      skuOptions: [{ skuId: '9001', name: '50x70', price: 1200, options: { Размер: '50x70 см' } }],
    };
    expect(isWbSizedDraft(pillow, { subjectName: 'Подушки', parentName: 'Дом' })).toBe(false);
    expect(isWbSizedDraft(pillow)).toBe(false);
    // WB 常把家纺检索成「Постельное бельё / Комплекты…」，旧规则里 «бель» 会误判成内衣
    expect(isWbSizedDraft(pillow, { subjectName: 'Постельное бельё', parentName: 'Дом' })).toBe(false);
    expect(
      isWbSizedDraft(pillow, { subjectName: 'Комплекты постельного белья', parentName: 'Домашний текстиль' }),
    ).toBe(false);
    expect(
      resolveWbSizedFlag({
        hintSized: true,
        subject: { subjectName: 'Постельное бельё' },
        sizeDirectory: ['50x70', '70x70'],
        draft: pillow,
      }),
    ).toBe(false);
    const payload = buildWbUploadPayload({
      subject: { subjectID: 4459, subjectName: 'Подушки' },
      draft: pillow,
      vendorCode: '9001',
      barcodes: ['bc-1'],
      characteristics: [],
      brand: 'NoName',
      sized: false,
    });
    expect(payload[0].variants[0].sizes[0]).not.toHaveProperty('techSize');
    expect(payload[0].variants[0].sizes[0]).not.toHaveProperty('wbSize');
  });

  it('treats one-size and accessory products as sizeless even in clothing-adjacent subjects', () => {
    const oneSizeHat = {
      skuId: '8801',
      name: 'Шапка универсальная',
      categoryPath: 'Одежда / Аксессуары / Шапки',
      price: 500,
      imageUrls: [],
      specs: [{ name: 'Размер', value: 'единый размер' }],
      skuOptions: [{ skuId: '8801', name: 'One Size', price: 500, options: { Размер: 'единый' } }],
    };
    expect(looksLikeOneSizeValue('единый размер')).toBe(true);
    expect(looksLikeOneSizeValue('均码')).toBe(true);
    expect(looksLikeOneSizeValue('One Size')).toBe(true);
    expect(looksLikeOneSizeValue('M')).toBe(false);
    expect(isWbSizedDraft(oneSizeHat, { isSize: true, subjectName: 'Шапки', parentName: 'Аксессуары' })).toBe(false);
    expect(
      resolveWbSizedFlag({
        hintSized: true,
        subject: { isSize: true, subjectName: 'Шапки' },
        sizeDirectory: ['S', 'M', 'L'],
        draft: oneSizeHat,
      }),
    ).toBe(false);

    const phoneCase = {
      skuId: '8802',
      name: 'Чехол для телефона',
      categoryPath: 'Электроника / Аксессуары для телефонов',
      price: 300,
      imageUrls: [],
      specs: [],
      skuOptions: [{ skuId: '8802', name: 'iPhone 15', price: 300, options: { Модель: 'iPhone 15' } }],
    };
    expect(isWbSizedDraft(phoneCase, { isSize: true, subjectName: 'Чехлы', parentName: 'Электроника' })).toBe(false);
  });

  it('still treats underwear as a sized clothing category', () => {
    expect(
      isWbSizedDraft(
        {
          skuId: '2',
          name: 'Трусы',
          categoryPath: 'Одежда / Нижнее бельё',
          price: 10,
          imageUrls: [],
          specs: [],
          skuOptions: [{ skuId: '2', name: 'M', price: 10, options: { Размер: 'M' } }],
        },
        { subjectName: 'Трусы', parentName: 'Нижнее бельё' },
      ),
    ).toBe(true);
  });

  it('separates apparel size values from physical dimensions and weights', () => {
    expect(looksLikeApparelSizeValue('M')).toBe(true);
    expect(looksLikeApparelSizeValue('XXL')).toBe(true);
    expect(looksLikeApparelSizeValue('46')).toBe(true);
    expect(looksLikeApparelSizeValue('46-48')).toBe(true);
    expect(looksLikeApparelSizeValue('50x70 см')).toBe(false);
    expect(looksLikeApparelSizeValue('единый размер')).toBe(false);
    expect(looksLikeApparelSizeValue('均码')).toBe(false);
    expect(looksLikeApparelSizeValue('1000')).toBe(false);
    expect(looksLikeApparelSizeValue('250 г')).toBe(false);
    expect(looksLikeApparelSizeValue('120 см')).toBe(false);
  });

  it('drops Ozon variant labels that are not colors instead of sending them to WB', () => {
    // 实际拒卡场景：Недопустимое значение цвета "Лебяжий пух, чехол из микрофибры2"
    expect(sanitizeWbColorValue('Лебяжий пух, чехол из микрофибры2')).toEqual([]);
    const directory = [{ name: 'белый' }, { name: 'черный' }, { name: 'разноцветный' }];
    expect(resolveWbColorValue(['Лебяжий пух, чехол из микрофибры2'], directory)).toBeNull();
    expect(resolveWbColorValue(['Лебяжий пух, чехол из микрофибры2'], directory, { required: true })).toBe(
      'разноцветный',
    );
    // 颜色目录没拉到时也绝不能把填充物原文提交给 WB；必填则改走兜底色
    expect(resolveWbColorValue(['Лебяжий пух, чехол из микрофибры2'], [])).toBeNull();
    expect(resolveWbColorValue(['Лебяжий пух, чехол из микрофибры2'], [], { required: true })).toBe('разноцветный');
  });

  it('maps color synonyms and compound colors onto the WB color directory', () => {
    const directory = [{ name: 'белый' }, { name: 'черный' }, { name: 'синий' }];
    expect(resolveWbColorValue(['黑色'], directory)).toBe('черный');
    expect(resolveWbColorValue(['Black'], directory)).toBe('черный');
    expect(resolveWbColorValue(['тёмно-синий'], directory)).toBe('синий');
    expect(resolveWbColorValue(['белый2'], directory)).toBe('белый');
    // 目录没拉到时保留原值，交由 WB 判定，不因为目录缺失卡住上架
    expect(resolveWbColorValue(['бирюзовый'], [])).toBe('бирюзовый');
  });

  it('never sends a free-text color when the WB directory is available', () => {
    const mapped = mapWbCharacteristics(
      [{ charcID: 12, name: 'Цвет', required: false }],
      {
        skuId: '9001',
        name: 'Подушка',
        price: 1200,
        imageUrls: [],
        specs: [{ name: 'Цвет', value: 'Лебяжий пух, чехол из микрофибры2' }],
        skuOptions: [],
      },
      { colors: [{ name: 'белый' }, { name: 'черный' }] },
    );
    expect(mapped.characteristics).toEqual([]);
    expect(mapped.missingRequired).toEqual([]);
  });

  it('skips characteristics that WB rejected on a previous attempt', () => {
    const mapped = mapWbCharacteristics(
      [
        { charcID: 12, name: 'Цвет', required: false },
        { charcID: 40, name: 'Состав', required: false },
      ],
      {
        skuId: '1',
        name: 'Item',
        price: 10,
        imageUrls: [],
        specs: [
          { name: 'Цвет', value: 'белый' },
          { name: 'Состав', value: 'хлопок' },
        ],
        skuOptions: [],
      },
      { colors: [{ name: 'белый' }] },
      { skipCharcIds: [12] },
    );
    expect(mapped.characteristics).toEqual([{ id: 40, value: ['хлопок'] }]);
  });

  it('clamps list characteristics to the WB maxCount', () => {
    const mapped = mapWbCharacteristics(
      [{ charcID: 40, name: 'Состав', required: false, maxCount: 1 }],
      {
        skuId: '1',
        name: 'Item',
        price: 10,
        imageUrls: [],
        specs: [{ name: 'Состав', value: 'хлопок' }],
        skuOptions: [],
      },
    );
    expect(mapped.characteristics).toEqual([{ id: 40, value: ['хлопок'] }]);
  });
});

describe('wb card repair planner', () => {
  const baseState = (): WbCardRepairState => ({
    sized: true,
    droppedCharcIds: [],
    descriptionMax: WB_DESCRIPTION_MAX,
    genericBrand: false,
  });

  it('turns the sizeless-product rejection into a sizeless rebuild', () => {
    const plan = planWbCardRepair(
      [
        'Недопустимо указывать Размер и Рос.Размер для безразмерного товара. Пожалуйста, удалите запись с карточкой из вкладки "Черновик" и попробуйте создать/отредактировать карточку повторно, но без размеров.',
      ],
      { state: baseState() },
    );
    expect(plan).toMatchObject({ sized: false, recreate: true });
  });

  it('adds sizes back when WB says the size is mandatory', () => {
    const plan = planWbCardRepair(['Не указан размер товара'], { state: { ...baseState(), sized: false } });
    expect(plan).toMatchObject({ sized: true, recreate: true });
  });

  it('drops the color characteristic when WB rejects the color value', () => {
    const plan = planWbCardRepair(['Недопустимое значение цвета "Лебяжий пух, чехол из микрофибры2"'], {
      charcs: [
        { charcID: 12, name: 'Цвет' },
        { charcID: 40, name: 'Состав' },
      ],
      state: baseState(),
    });
    expect(plan).toMatchObject({ dropCharcIds: [12], recreate: true });
  });

  it('drops any characteristic named in the rejection message', () => {
    const plan = planWbCardRepair(['Недопустимое значение характеристики «Комплектация»'], {
      charcs: [{ charcID: 77, name: 'Комплектация' }],
      state: baseState(),
    });
    expect(plan?.dropCharcIds).toEqual([77]);
  });

  it('tightens the description limit reported by WB', () => {
    const plan = planWbCardRepair(['Описание не более 1000 символов'], { state: baseState() });
    expect(plan).toMatchObject({ descriptionMax: 1000, recreate: true });
  });

  it('falls back to a generic brand once, then gives up', () => {
    const state = baseState();
    expect(planWbCardRepair(['Бренд «MyShop» не найден'], { state })).toMatchObject({ useGenericBrand: true });
    expect(planWbCardRepair(['Бренд «MyShop» не найден'], { state: { ...state, genericBrand: true } })).toBeNull();
  });

  it('returns null for rejections without a known automatic fix', () => {
    expect(planWbCardRepair(['Товар нарушает правила площадки'], { state: baseState() })).toBeNull();
    expect(planWbCardRepair([], { state: baseState() })).toBeNull();
  });

  it('does not re-drop a characteristic that is already dropped', () => {
    const plan = planWbCardRepair(['Недопустимое значение цвета "x"'], {
      charcs: [{ charcID: 12, name: 'Цвет' }],
      state: { ...baseState(), droppedCharcIds: [12] },
    });
    expect(plan).toBeNull();
  });
});

describe('ozon category key', () => {
  it('collapses casing, spacing and separators so one Ozon category maps once', () => {
    expect(normalizeOzonCategoryKey('Дом и сад / Домашний текстиль / Подушки')).toBe(
      'дом и сад / домашний текстиль / подушки',
    );
    expect(normalizeOzonCategoryKey('Дом и сад/Домашний  текстиль/Подушки')).toBe(
      normalizeOzonCategoryKey('дом и сад / домашний текстиль / подушки'),
    );
    expect(normalizeOzonCategoryKey('')).toBe('');
    expect(normalizeOzonCategoryKey(null)).toBe('');
  });
});
