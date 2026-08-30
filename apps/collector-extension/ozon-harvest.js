/**
 * Runs in the Ozon page MAIN world so fetch() keeps Origin: https://www.ozon.ru.
 * Returns compact dimSpecs only — never ship full widgetStates through executeScript IPC.
 */
(function (global) {
  const FETCH_CACHE_MAX = 24;
  if (!global.__aiecomOzonFetchCache) {
    global.__aiecomOzonFetchCache = [];
    const originalFetch = global.fetch;
    if (typeof originalFetch === 'function') {
      global.fetch = function (input, init) {
        const request = originalFetch.call(this, input, init);
        try {
          const url = String((input && input.url) || input || '');
          if (/entrypoint-api\.bx|composer-api\.bx/i.test(url)) {
            Promise.resolve(request)
              .then((res) => res.clone().text().then((text) => ({ res, text })))
              .then(({ res, text }) => {
                const cache = global.__aiecomOzonFetchCache;
                cache.push({ url, status: res.status, ok: res.ok, text: String(text || '').slice(0, 800000) });
                if (cache.length > FETCH_CACHE_MAX) cache.splice(0, cache.length - FETCH_CACHE_MAX);
              })
              .catch(() => undefined);
          }
        } catch (_e) {
          /* ignore */
        }
        return request;
      };
    }
  }
  function parseDimensionString(raw) {
    const source = String(raw == null ? '' : raw);
    const text = source.replace(/,/g, '.').replace(/\s+/g, '').trim();
    const match = text.match(
      /^(\d+(?:\.\d+)?)\s*[xх×*]\s*(\d+(?:\.\d+)?)(?:\s*[xх×*]\s*(\d+(?:\.\d+)?))?(?:мм|mm|см|cm)?$/i,
    );
    if (!match) return null;
    const rawDepth = Number(match[1]);
    const rawWidth = Number(match[2]);
    const rawHeight = Number(match[3] || 0);
    if (![rawDepth, rawWidth].every((item) => Number.isFinite(item) && item > 0)) return null;
    const hasCm = /см|cm/i.test(source) && !/мм|mm/i.test(source);
    const hasMm = /мм|mm/i.test(source);
    const asCm =
      hasCm || (!hasMm && !rawHeight && Math.max(rawDepth, rawWidth) >= 40 && Math.max(rawDepth, rawWidth) <= 400);
    const toMm = (value) => (asCm ? value * 10 : value);
    const depth = toMm(rawDepth);
    const width = toMm(rawWidth);
    const height = rawHeight > 0 ? toMm(rawHeight) : 0;
    if (![depth, width].every((item) => item > 0 && item < 5000) || height >= 5000) return null;
    return { depth, width, height };
  }

  function readWeightGrams(raw) {
    if (typeof raw === 'string') {
      const match = raw.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g)?/i);
      if (!match) return 0;
      const num = Number(match[1]);
      if (!Number.isFinite(num) || num <= 0) return 0;
      if (match[2] && /кг|kg/i.test(match[2])) return Math.round(num * 1000);
      return readWeightGrams(num);
    }
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight <= 0 || weight >= 100000) return 0;
    if (weight > 0 && weight < 80 && weight % 1 !== 0) return Math.round(weight * 1000);
    return weight;
  }

  function isUrlish(raw) {
    return typeof raw === 'string' && (/^https?:\/\//i.test(raw) || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(raw));
  }

  function isMediaObject(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.dimension != null || obj.weight != null || obj.dimensions != null || obj.packageSize != null) return false;
    return isUrlish(obj.src) || isUrlish(obj.original) || isUrlish(obj.srcset) || isUrlish(obj.previewUrl);
  }

  function skuOf(obj) {
    if (!obj || typeof obj !== 'object') return '';
    // widget/offer `id` is not the product sku — only trust explicit sku fields
    const value = obj.sku != null ? obj.sku : obj.skuId != null ? obj.skuId : obj.productId;
    const match = String(value == null ? '' : value).match(/(\d{6,})/);
    return match ? match[1] : '';
  }

  function unescapeJsonText(text) {
    return String(text || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  function isDimCharName(name) {
    const n = normalizeCharKey(name);
    if (/кольц|ringsize|длина в мм|диагональ|экран|ssd|весь ozon/.test(n)) return false;
    return /^(вес(?![а-яё])|вес,|вес товара|вес брутто|вес в упаков|вес нетто|масса(?![а-яё]))|длина|ширина|высота|глубина|толщина|weight|length|width|height|depth|габарит|размер|упаковк|объем|package/.test(
      n,
    );
  }

  function normalizeCharKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[_:/\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 只有「长/宽/高/重量 + 包装」才是物流口径。「Упаковка=Коробка」只是包装类型，不是尺寸 */
  function isPackageCharName(name) {
    const n = normalizeCharKey(name);
    if (/брутто|brutto|gross|посылк/.test(n)) return true;
    return (
      /упаковк/.test(n) &&
      /длина|ширина|высота|глубина|вес|масс|размер|габарит|length|width|height|weight|depth/.test(n)
    );
  }

  /**
   * 上架必填/常用属性字典：把 Ozon 五花八门的特性名收敛到一组固定俄文键，
   * 服务端 mapWbCharacteristics / mapPackageDimensions 按这些键名取值。
   */
  const ATTR_DICT = [
    { out: 'Бренд', match: /^(бренд|торговая марка|brand|марка)/ },
    { out: 'Цвет', match: /^(цвет|основной цвет|цвет товара|colour|color)/ },
    { out: 'Материал', match: /^(материал|основной материал|материал изделия|material)/ },
    { out: 'Состав', match: /^(состав|состав материала|состав ткани|composition)/ },
    { out: 'Страна-изготовитель', match: /^(страна|страна изготовитель|страна производства|страна производитель|country)/ },
    { out: 'Пол', match: /^(пол(?![а-я])|пол покупателя|для кого|gender)/ },
    { out: 'Сезон', match: /^(сезон|season)/ },
    { out: 'Возраст', match: /^(возраст|возрастная группа|возрастные ограничения)/ },
    { out: 'Артикул производителя', match: /^(артикул|артикул производителя|партномер|парт номер|номер модели|модель)/ },
    { out: 'ТН ВЭД', match: /^(тн вэд|тнвэд|код тн вэд|hs код|tnved)/ },
    { out: 'Штрихкод', match: /^(штрихкод|штрих код|ean|gtin|barcode)/ },
    { out: 'Объем, л', match: /^(объем|объем товара|объем упаковки|volume)/ },
    { out: 'Комплектация', match: /^(комплектация|в комплекте|состав комплекта|комплект поставки)/ },
    { out: 'Гарантийный срок', match: /^(гарантийный срок|гарантия|срок гарантии)/ },
    { out: 'Количество в упаковке', match: /^(количество в упаковке|кол во в упаковке|количество предметов|количество штук|количество единиц)/ },
    { out: 'Срок годности', match: /^(срок годности|срок хранения)/ },
    { out: 'Тип', match: /^(тип(?![а-я])|тип товара|вид товара|вид(?![а-я]))/ },
    { out: 'Назначение', match: /^назначение/ },
    { out: 'Размер производителя', match: /^(размер производителя|российский размер|размер ru|размер eu)/ },
  ];

  /** 命中字典则返回统一键名；未命中返回空串（原名保留在 specs 里，不丢信息） */
  function canonicalAttrName(name) {
    const key = normalizeCharKey(name);
    if (!key || isPackageCharName(name)) return '';
    for (let i = 0; i < ATTR_DICT.length; i += 1) {
      if (ATTR_DICT[i].match.test(key)) return ATTR_DICT[i].out;
    }
    return '';
  }

  function parseSizePairsMm(raw) {
    const source = String(raw || '').replace(/,/g, '.');
    const pairs = [];
    const re =
      /(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?\s*[xх×*]\s*(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?(?:\s*[xх×*]\s*(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?)?/gi;
    let match;
    while ((match = re.exec(source))) {
      const rawDepth = Number(match[1]);
      const rawWidth = Number(match[3]);
      const rawHeight = Number(match[5] || 0);
      if (![rawDepth, rawWidth].every((item) => Number.isFinite(item) && item > 0)) continue;
      const unitBlob = (match[2] || '') + ' ' + (match[4] || '') + ' ' + (match[6] || '') + ' ' + source;
      const hasCm = /см|cm/i.test(unitBlob) && !/мм|mm/i.test(unitBlob);
      const hasMm = /мм|mm/i.test(unitBlob);
      const asCm =
        hasCm || (!hasMm && !rawHeight && Math.max(rawDepth, rawWidth) >= 40 && Math.max(rawDepth, rawWidth) <= 400);
      const toMm = (value) => (asCm ? value * 10 : value);
      const depth = toMm(rawDepth);
      const width = toMm(rawWidth);
      const height = rawHeight > 0 ? toMm(rawHeight) : 0;
      if (depth > 0 && width > 0 && depth < 5000 && width < 5000 && height < 5000) {
        pairs.push({ depth, width, height });
      }
    }
    return pairs;
  }

  function namedToMm(value, blob) {
    const num = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(num) || num <= 0) return 0;
    return /см|cm/i.test(blob) && !/мм|mm/i.test(blob) ? num * 10 : num;
  }

  /** 单位优先取本行名里的；本行没写单位才退回三边名拼串（Ozon 常只在最后一边标 см） */
  function edgeToMm(row, blob) {
    const own = String((row && row.name) || '');
    return namedToMm(row && row.value, /см|cm|мм|mm/i.test(own) ? own : blob);
  }

  function pushUnique(list, url) {
    if (typeof url === 'string' && url && list.indexOf(url) < 0) list.push(url);
  }

  function isTrustedDimWidgetKey(key) {
    return /webSale|webDelivery|webOutOfStock|webShipping|webCharacteristics|webShortCharacteristics|webProductMainWidget|webDetailSKU|webPdp|webPrice|webAspects|webAnnotation|webRichAnnotation/i.test(
      String(key || ''),
    );
  }

  function collectDimsFromObject(obj, pageSku, buckets, sku, allowUnscoped, forcePkg) {
    if (!obj || typeof obj !== 'object' || isMediaObject(obj)) return;
    sku = sku || skuOf(obj);
    const hasLogistics =
      obj.dimension != null ||
      obj.packageSize != null ||
      obj.packageSizeMm != null ||
      obj.packageWeight != null ||
      obj.packageDimensions != null ||
      obj.weight != null ||
      obj.weightGrams != null ||
      (obj.dimensions != null && typeof obj.dimensions === 'object');
    if (pageSku && sku && sku !== String(pageSku) && !(allowUnscoped && hasLogistics)) return;
    if (pageSku && !sku && !allowUnscoped) return;
    const nested =
      (obj.dimensions && typeof obj.dimensions === 'object' ? obj.dimensions : null) ||
      (obj.packageDimensions && typeof obj.packageDimensions === 'object' ? obj.packageDimensions : null) ||
      (obj.packageSize && typeof obj.packageSize === 'object' ? obj.packageSize : null);
    const fromString =
      parseDimensionString(obj.dimension) ||
      parseDimensionString(typeof obj.dimensions === 'string' ? obj.dimensions : '') ||
      parseDimensionString(obj.packageSize) ||
      parseDimensionString(obj.packageSizeMm) ||
      parseDimensionString(typeof obj.volume === 'string' ? obj.volume : '') ||
      parseDimensionString(nested && (nested.dimension || nested.value || nested.text));
    const src = nested || obj;
    const depth = fromString ? fromString.depth : Number(src.depth != null ? src.depth : src.length != null ? src.length : obj.depth != null ? obj.depth : obj.length);
    const width = fromString ? fromString.width : Number(src.width != null ? src.width : obj.width);
    const height = fromString
      ? fromString.height
      : Number(src.height != null ? src.height : obj.height);
    const weightKg = Number(src.weightKg != null ? src.weightKg : obj.weightKg);
    const weight =
      Number.isFinite(weightKg) && weightKg > 0 && weightKg < 80
        ? Math.round(weightKg * 1000)
        : readWeightGrams(
            src.weight != null
              ? src.weight
              : obj.weight != null
                ? obj.weight
                : obj.weightGrams != null
                  ? obj.weightGrams
                  : obj.packageWeight != null
                    ? obj.packageWeight
                    : obj.weightG != null
                      ? obj.weightG
                      : obj.itemWeight != null
                        ? obj.itemWeight
                        : obj.grossWeight != null
                          ? obj.grossWeight
                          : obj.weightGrams,
          );
    const hasEdges = [depth, width, height].every((item) => Number.isFinite(item) && item > 0 && item < 5000);
    const hasFlat =
      [depth, width].every((item) => Number.isFinite(item) && item > 0 && item < 5000) && Math.max(depth, width) >= 400;
    const score = pageSku && sku === String(pageSku) ? 2 : 1;
    // Ozon 的 `dimension`/`packageSize`/`packageWeight` 就是仓内物流口径（发货包裹），
    // 与特性表里的商品净尺寸必须分开，否则毛重会被当成净重再加一次包装余量
    const pkg = Boolean(
      forcePkg ||
        obj.dimension != null ||
        obj.packageSize != null ||
        obj.packageSizeMm != null ||
        obj.packageWeight != null ||
        obj.packageDimensions != null,
    );
    if (hasEdges) {
      buckets.edges.push({ depth, width, height, score, pkg });
    } else if (hasFlat) {
      buckets.edges.push({ depth, width, height: 20, score, pkg });
    }
    if (weight > 0) {
      buckets.weights.push({ weight, score, pkg });
    }
  }

  function specText(raw, depth) {
    if (depth > 6 || raw == null) return '';
    if (typeof raw === 'string' || typeof raw === 'number') {
      const text = String(raw).replace(/\s+/g, ' ').trim();
      return text === '[object Object]' ? '' : text;
    }
    if (Array.isArray(raw)) {
      // Ozon 的多值原子常自带尾逗号，直接 join 会得到「Пластик,, Металл」
      return raw
        .map((item) => specText(item, (depth || 0) + 1).replace(/[,;]\s*$/, ''))
        .filter(Boolean)
        .join(', ');
    }
    if (typeof raw !== 'object') return '';
    const keys = [
      'text',
      'content',
      'textRs',
      'textAtom',
      'contentRS',
      'valueRs',
      'titleRs',
      'value',
      'title',
      'name',
      'label',
      'key',
      'caption',
    ];
    for (let i = 0; i < keys.length; i += 1) {
      if (raw[keys[i]] == null) continue;
      const found = specText(raw[keys[i]], (depth || 0) + 1);
      if (found) return found;
    }
    return '';
  }

  function asRows(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'object') return [];
    const nested = []
      .concat(Array.isArray(raw.long) ? raw.long : [])
      .concat(Array.isArray(raw.short) ? raw.short : [])
      .concat(Array.isArray(raw.all) ? raw.all : [])
      .concat(Array.isArray(raw.characteristics) ? raw.characteristics : [])
      .concat(Array.isArray(raw.items) ? raw.items : [])
      .concat(Array.isArray(raw.values) ? raw.values : [])
      .concat(Array.isArray(raw.rs) ? raw.rs : [])
      .concat(Array.isArray(raw.groups) ? raw.groups : [])
      .concat(Array.isArray(raw.sections) ? raw.sections : [])
      .concat(Array.isArray(raw.rows) ? raw.rows : []);
    if (nested.length) return nested;
    if (raw.title || raw.name || raw.key || raw.titleRs || raw.value || raw.valueRs || raw.contentRS) return [raw];
    return [];
  }

  function collectChars(obj, _pageSku, buckets) {
    if (!obj || typeof obj !== 'object') return;
    const rows = [];
    function flatten(list) {
      asRows(list).forEach((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          if (Array.isArray(row)) flatten(row);
          return;
        }
        rows.push(row);
        flatten(row.long);
        flatten(row.short);
        flatten(row.all);
        flatten(row.characteristics);
        flatten(row.groups);
        flatten(row.sections);
        flatten(row.items);
        flatten(row.blocks);
      });
    }
    flatten(obj.characteristics);
    flatten(obj.blocks);
    flatten(obj.shortCharacteristics);
    flatten(obj.characteristicsList);
    flatten(obj.fullCharacteristics);
    flatten(obj.long);
    flatten(obj.short);
    flatten(obj.all);
    flatten(obj.params);
    flatten(obj.properties);
    flatten(obj.groups);
    flatten(obj.sections);
    rows.forEach((row) => {
      const name = specText(row.title || row.name || row.key || row.titleRs).replace(/\s+/g, ' ').trim();
      const value = specText(
        row.values !== undefined
          ? row.values
          : row.contentRS !== undefined
            ? row.contentRS
            : row.valueRs !== undefined
              ? row.valueRs
              : row.value,
      );
      if (!name || !value || name.length > 80 || value.length > 800) return;
      if (!buckets.charNames) buckets.charNames = [];
      if (buckets.charNames.length < 80 && buckets.charNames.indexOf(name) < 0) buckets.charNames.push(name);
      buckets.chars.push({ name, value, score: isDimCharName(name) ? 2 : 0 });
    });
  }

  function walk(node, visit, depth, ancestorSku) {
    if (depth > 22 || node == null) return;
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length > 8) {
        try {
          walk(JSON.parse(trimmed), visit, depth + 1, ancestorSku);
        } catch (_e) {
          /* ignore */
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, visit, depth + 1, ancestorSku));
      return;
    }
    if (typeof node !== 'object') return;
    const sku = skuOf(node) || ancestorSku || '';
    try {
      visit(node, sku);
    } catch (_e) {
      /* one widget must not abort the rest of the tree */
    }
    Object.keys(node).forEach((key) => {
      if (isRecommendWidgetKey(key)) return;
      walk(node[key], visit, depth + 1, sku);
    });
  }

  function collectLabeledText(text, buckets) {
    const source = String(text || '').replace(/\\n/g, '\n');
    const found = [];
    const re = /(?:^|[\n;；])\s*([A-Za-zА-ЯЁа-яё][^:\n]{0,40}?)\s*[:：][^\S\n]*/g;
    let match;
    while ((match = re.exec(source))) {
      found.push({ name: specText(match[1]).trim(), start: match.index, valueStart: match.index + match[0].length });
    }
    found.forEach((item, i) => {
      const name = item.name;
      const value = source
        .slice(item.valueStart, found[i + 1] ? found[i + 1].start : source.length)
        .replace(/\s+/g, ' ')
        .trim();
      if (!name || !value || name.length > 80 || value.length > 800) return;
      if (/https?:|class=|widget|onclick/i.test(name + value)) return;
      if (!buckets.charNames) buckets.charNames = [];
      if (buckets.charNames.length < 80 && buckets.charNames.indexOf(name) < 0) buckets.charNames.push(name);
      buckets.chars.push({ name, value, score: isDimCharName(name) ? 1 : 0 });
    });
  }

  function collectMeta(obj, buckets) {
    if (!obj || typeof obj !== 'object') return;
    const meta = buckets.meta || (buckets.meta = {});
    if (!meta.brand) {
      const brand = specText(obj.brandName || obj.brand || (obj.brand && obj.brand.name));
      if (brand && brand.length < 80 && !/^ozon$/i.test(brand)) meta.brand = brand;
    }
    if (!meta.sellerName) {
      const seller = specText(
        obj.sellerName || (obj.sellerCell && obj.sellerCell.centerBlock && obj.sellerCell.centerBlock.title),
      );
      if (obj.sellerId || obj.sellerCell) {
        if (seller && seller.length < 80) meta.sellerName = seller;
        const sid = obj.sellerId || obj.id;
        if (sid) meta.sellerId = String(sid);
      }
    }
    if (!meta.description) {
      const html =
        (typeof obj.html === 'string' && obj.html) ||
        (typeof obj.richText === 'string' && obj.richText) ||
        (typeof obj.annotation === 'string' && obj.annotation) ||
        (typeof obj.richAnnotation === 'string' && obj.richAnnotation) ||
        '';
      const rich = html || specText(obj.richAnnotation || obj.textAtom);
      if (rich && rich.length > 40) {
        const text = String(rich)
          .replace(/<[^>]+>/g, '\n')
          .replace(/[ \t]+\n/g, '\n')
          .trim();
        if (text.length > 40) meta.description = text.slice(0, 8000);
        collectLabeledText(text, buckets);
      }
    }
    const rating = Number(obj.rating || obj.ratingValue || obj.reviewRating);
    if (!meta.rating && Number.isFinite(rating) && rating > 0 && rating <= 5) meta.rating = rating;
    const reviews = Number(obj.reviewCount || obj.reviewsCount || obj.questionsCount);
    if (!meta.reviewCount && Number.isFinite(reviews) && reviews > 0) meta.reviewCount = reviews;
    if (Array.isArray(obj.breadcrumbs) && obj.breadcrumbs.length >= 2) {
      const crumbs = obj.breadcrumbs.filter((item) => specText(item));
      // PDP 面包屑末项是品牌：链接在上一级品类链接下多一层（/category/stellazhi-15040/ridberg-100371122/）
      const last = crumbs[crumbs.length - 1] || {};
      const prev = crumbs[crumbs.length - 2] || {};
      const brandCrumb =
        last.link && prev.link && last.link !== prev.link && String(last.link).indexOf(String(prev.link)) === 0
          ? last
          : null;
      if (brandCrumb && !meta.brand) {
        const brand = specText(brandCrumb);
        if (brand && brand.length < 80 && !/^ozon$/i.test(brand)) meta.brand = brand;
      }
      if (!meta.categoryPath) {
        const names = (brandCrumb ? crumbs.slice(0, -1) : crumbs).map((item) => specText(item)).filter(Boolean);
        if (names.length >= 2) meta.categoryPath = names.join(' / ');
      }
    }
  }

  function isProductImageUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    if (/\.(svg|gif)(\?|$)/i.test(value)) return false;
    if (
      /\/cms\/|\/graphics\/|\/icons?\/|\/static\/|\/promo\/|\/bonus\/|\/marketing-api\/|\/banners?\/|searchteam-cdn|menu\.svg|favicon|sprite|logo/i.test(
        value,
      )
    ) {
      return false;
    }
    if (/(?:^|[/-])(?:logo|icon|badge|banner|sprite|avatar|favicon|payment|flame)(?:[/-]|\.|$)/i.test(value)) {
      return false;
    }
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(value) && !/ozone\.ru|ozonstatic|cdn/i.test(value)) return false;
    return /\/s3\/(?:multimedia|rp-photo)/i.test(value) || /\/multimedia(?:-\w+)?\//i.test(value);
  }

  function isRecommendWidgetKey(key) {
    return /tileGrid|skuGrid|recommend|similar|alsoBuy|boughtTogether|webList|collection|related|catalogMenu|tapTags|horizontalMenu|bigPromo/i.test(
      String(key || ''),
    );
  }

  function isPdpGalleryWidgetKey(key) {
    if (isRecommendWidgetKey(key)) return false;
    const name = String(key || '').split('-')[0];
    return /^(webGallery|galleryMobile|pdpGallery|webProductGallery|webPhotoGallery|productGallery)$/i.test(name);
  }

  function collectGalleryWidget(widget, imgUrls) {
    if (!widget || typeof widget !== 'object' || widget.tileImage || widget.mainState) return;
    function pushImage(value) {
      if (typeof value === 'string' && isProductImageUrl(value)) pushUnique(imgUrls, value.split(' ')[0]);
      else if (value && typeof value === 'object' && typeof value.url === 'string' && isProductImageUrl(value.url)) {
        pushUnique(imgUrls, value.url.split(' ')[0]);
      }
    }
    pushImage(widget.coverImage);
    pushImage(widget.coverImageUrl);
    ['images', 'media', 'photos', 'gallery'].forEach((key) => {
      if (!Array.isArray(widget[key])) return;
      widget[key].forEach((item) => {
        if (typeof item === 'string') {
          pushImage(item);
          return;
        }
        if (!item || typeof item !== 'object') return;
        pushImage(item.src);
        pushImage(item.url);
        pushImage(item.original);
        pushImage(item.coverImage);
        pushImage(item.image);
        pushImage(item.srcOriginal);
      });
    });
  }

  function collectVideo(obj, buckets) {
    if (!obj || typeof obj !== 'object') return;
    const video = obj.videoUrl || obj.mp4Url || obj.hls;
    if (typeof video === 'string' && /^https?:/i.test(video)) {
      const meta = buckets.meta || (buckets.meta = {});
      meta.videoUrls = meta.videoUrls || [];
      pushUnique(meta.videoUrls, video);
    }
  }

  function harvestTextFallbacks(text, pageSku, buckets) {
    if (!text) return;
    const skuHint = pageSku ? String(pageSku) : '';
    if (!skuHint) return;
    const source = unescapeJsonText(text);
    const dimRe =
      /dimension["\\]*\s*:\s*["\\]*(\d+(?:[.,]\d+)?\s*[xх×*]\s*\d+(?:[.,]\d+)?(?:\s*[xх×*]\s*\d+(?:[.,]\d+)?)?)(?:\s*(?:мм|mm|см|cm))?/gi;
    let match;
    while ((match = dimRe.exec(source))) {
      const around = source.slice(Math.max(0, match.index - 500), Math.min(source.length, match.index + 500));
      if (around.indexOf(skuHint) < 0 && !/\d+(?:[.,]\d+)?\s*[xх×*]\s*\d+(?:[.,]\d+)?\s*[xх×*]\s*\d+/.test(match[1])) {
        continue;
      }
      const unit = /см|cm/i.test(match[0]) && !/мм|mm/i.test(match[0]) ? 'см' : 'mm';
      const parsed = parseDimensionString(match[1] + unit);
      if (!parsed) continue;
      // 这里的 dimension 出自 cellTrackingInfo/webDelivery，属于发货包裹口径
      buckets.edges.push({ ...parsed, score: 2, pkg: true });
    }
    const weightRe = /["\\]weight["\\]\s*:\s*["\\]?(\d+(?:\.\d+)?)/gi;
    while ((match = weightRe.exec(source))) {
      const around = source.slice(Math.max(0, match.index - 500), Math.min(source.length, match.index + 200));
      if (/font-weight|fontWeight|font_weight/i.test(around)) continue;
      if (around.indexOf(skuHint) < 0 && !/"dimension"\s*:/.test(around) && !/packageWeight|packageSize/.test(around)) {
        continue;
      }
      const weight = readWeightGrams(match[1]);
      if (weight <= 0) continue;
      buckets.weights.push({ weight, score: 2, pkg: true });
    }
  }

  function probeText(text, debug) {
    if (!text || !debug || debug.length >= 12) return;
    const source = unescapeJsonText(text);
    const needles = [
      'dimension',
      '"weight"',
      'Вес товара',
      'Длина, мм',
      'Длина упаковки',
      '"depth"',
      'packageWeight',
      '211x46',
    ];
    for (let i = 0; i < needles.length && debug.length < 12; i += 1) {
      const key = needles[i];
      const at = source.indexOf(key);
      if (at < 0) continue;
      const snippet = source.slice(Math.max(0, at - 48), at + 96).replace(/\s+/g, ' ').slice(0, 160);
      if (/ringSize|Весь Ozon|serviceButton|font-weight|fontWeight/i.test(snippet)) continue;
      debug.push({ key, snippet });
    }
  }

  function widgetName(key) {
    return String(key || '').split('-')[0];
  }

  function ingestNamedWidgets(json, pageSku, buckets, imgUrls) {
    const ws = json && json.widgetStates;
    if (!ws || typeof ws !== 'object') return;
    function widgets(name) {
      return Object.keys(ws)
        .filter((key) => widgetName(key) === name)
        .map((key) => {
          let widget = ws[key];
          if (typeof widget === 'string') {
            try {
              widget = JSON.parse(widget);
            } catch (_e) {
              return null;
            }
          }
          return widget && typeof widget === 'object' ? widget : null;
        })
        .filter(Boolean);
    }
    ['webShortCharacteristics', 'webCharacteristics'].forEach((name) => {
      widgets(name).forEach((widget) => collectChars(widget, pageSku, buckets));
    });
    widgets('webDescription').forEach((widget) => {
      const meta = buckets.meta || (buckets.meta = {});
      const raw = widget.richAnnotation || widget.text || widget.html || widget.description;
      const text = typeof raw === 'string' ? raw : specText(raw);
      if (text) {
        collectLabeledText(text, buckets);
        if (!meta.description && text.replace(/\s+/g, ' ').trim().length > 40) {
          meta.description = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
        }
      }
    });
    widgets('webGallery').forEach((widget) => collectGalleryWidget(widget, imgUrls));
    widgets('webCurrentSeller').forEach((widget) => {
      const meta = buckets.meta || (buckets.meta = {});
      const seller = specText(
        widget.name || (widget.sellerCell && widget.sellerCell.centerBlock && widget.sellerCell.centerBlock.title),
      );
      if (seller) meta.sellerName = seller;
      if (widget.id) meta.sellerId = String(widget.id);
    });
    widgets('webBrand').forEach((widget) => {
      const meta = buckets.meta || (buckets.meta = {});
      const brand = specText(widget.name || widget.title || widget.brandName);
      if (brand) meta.brand = brand;
    });
    widgets('webProductHeading').forEach((widget) => {
      const meta = buckets.meta || (buckets.meta = {});
      const title = specText(widget.title || widget.name || widget.text);
      if (title) meta.title = title;
    });
    widgets('webPrice').forEach((widget) => {
      const meta = buckets.meta || (buckets.meta = {});
      const card = Number(String(widget.cardPrice || widget.price || '').replace(/[^\d.]/g, ''));
      const original = Number(String(widget.originalPrice || widget.priceWithoutDiscount || '').replace(/[^\d.]/g, ''));
      if (card > 10 && card < 1e7) meta.price = card;
      if (original > 10 && original < 1e7) meta.originalPrice = original;
    });
  }

  /** 从「长/宽/高（упаковки）」「вес брутто / вес в упаковке」这类特性名里补齐发货包裹口径 */
  function applyPackageFromChars(buckets) {
    const chars = (buckets.chars || []).filter((row) => isPackageCharName(row.name));
    if (!chars.length) return;
    if (!buckets.edges.some((item) => item.pkg)) {
      const length = chars.find((row) => /длина|глубина|length|depth/.test(normalizeCharKey(row.name)));
      const width = chars.find((row) => /ширина|width/.test(normalizeCharKey(row.name)));
      const height = chars.find((row) => /высота|толщина|height/.test(normalizeCharKey(row.name)));
      if (length && width && height) {
        const blob = length.name + ' ' + width.name + ' ' + height.name;
        const depth = edgeToMm(length, blob);
        const w = edgeToMm(width, blob);
        const h = edgeToMm(height, blob);
        if ([depth, w, h].every((item) => item > 0 && item < 5000)) {
          buckets.edges.push({ depth, width: w, height: h, score: 4, pkg: true });
        }
      } else {
        const sizeRow = chars.find((row) => /размер|габарит/.test(normalizeCharKey(row.name)));
        const parsed = sizeRow ? parseDimensionString(sizeRow.value) : null;
        if (parsed && parsed.depth > 0 && parsed.width > 0 && parsed.height > 0) {
          buckets.edges.push({ ...parsed, score: 4, pkg: true });
        }
      }
    }
    if (!buckets.weights.some((item) => item.pkg)) {
      const weightRow = chars.find((row) => /вес|масса|weight/.test(normalizeCharKey(row.name)));
      if (weightRow) {
        const weight = readWeightGrams(
          /кг|kg/i.test(weightRow.name + ' ' + weightRow.value) ? weightRow.value + ' кг' : weightRow.value,
        );
        if (weight > 0) buckets.weights.push({ weight, score: 4, pkg: true });
      }
    }
  }

  function applyWarehouseFromChars(buckets) {
    const chars = (buckets.chars || []).filter((row) => !isPackageCharName(row.name));
    if (!buckets.edges.some((item) => !item.pkg)) {
      const sizeRow = chars.find((row) => {
        const key = String(row.name || '')
          .toLowerCase()
          .replace(/ё/g, 'е');
        return /^(размер(?!а производителя)|габарит)/.test(key) && !/экран|диагональ|ssd|кольц/.test(key);
      });
      if (sizeRow) {
        const parsed = parseDimensionString(sizeRow.value);
        if (parsed && parsed.depth > 0 && parsed.width > 0) {
          // 尺寸行自带第三边时以它为准；再去取「Высота」会把已解析的厚度冲掉（两处单位口径常不一致）
          const thickRow =
            parsed.height > 0
              ? null
              : chars.find((row) => /^(высота|толщина)/i.test(row.name) && !/экран/i.test(row.name));
          const thick = thickRow ? namedToMm(thickRow.value, thickRow.name + ' ' + thickRow.value) : parsed.height;
          const fallback = Math.max(parsed.depth, parsed.width) >= 400 ? 20 : 0;
          const nextHeight = Math.max(1, Math.round(thick > 0 && thick < 5000 ? thick : fallback));
          if (nextHeight > 0 && (parsed.height > 0 || thick > 0 || fallback)) {
            buckets.edges.push({
              depth: parsed.height > 0 ? parsed.depth : Math.max(parsed.depth, parsed.width),
              width: parsed.height > 0 ? parsed.width : Math.min(parsed.depth, parsed.width),
              height: nextHeight,
              score: 3,
              pkg: false,
            });
          }
        }
      }
      // 家具/家居类 Ozon 只给 Глубина（深度）不给 Длина，两种叫法都要认，否则三边永远配不齐
      const length =
        chars.find((row) => /^длина/i.test(row.name) && !/экран|кольц|в мм/i.test(row.name)) ||
        chars.find((row) => /^(глубина|depth|length)/i.test(row.name) && !/экран/i.test(row.name));
      const width = chars.find((row) => /^(ширина|width)/i.test(row.name));
      const height = chars.find((row) => /^(высота|толщина|height)/i.test(row.name) && !/экран/i.test(row.name));
      if (length && width && height) {
        const blob = length.name + ' ' + width.name + ' ' + height.name;
        const depth = edgeToMm(length, blob);
        const w = edgeToMm(width, blob);
        const h = edgeToMm(height, blob);
        if ([depth, w, h].every((item) => item > 0 && item < 5000)) {
          buckets.edges.push({ depth, width: w, height: h, score: 3, pkg: false });
        }
      }
      // 锅/盆等圆形件只有「Диаметр дна + Высота стенки」，没有 длина/ширина
      if (!buckets.edges.some((item) => !item.pkg)) {
        const diameter = chars.find((row) => {
          const key = normalizeCharKey(row.name);
          return /диаметр|diameter/.test(key) && !/крышк|покрыт|кольц|экран/.test(key);
        });
        const wall = chars.find((row) => {
          const key = normalizeCharKey(row.name);
          return /^(высота стенки|высота(?!.*крыш)|height)/.test(key) && !/толщина|экран/.test(key);
        });
        if (diameter && wall) {
          const d = edgeToMm(diameter, diameter.name);
          const h = edgeToMm(wall, wall.name);
          if (d > 20 && d < 5000 && h > 0 && h < 5000) {
            buckets.edges.push({ depth: d, width: d, height: h, score: 3, pkg: false });
          }
        }
      }
      if (!buckets.edges.some((item) => !item.pkg) && sizeRow) {
        const pairs = parseSizePairsMm(sizeRow.value).sort((a, b) => b.depth * b.width - a.depth * a.width);
        const best = pairs[0];
        const thick = height ? namedToMm(height.value, height.name + ' ' + height.value) : best && best.height;
        if (best && ((thick > 0 && thick < 5000) || (!best.height && Math.max(best.depth, best.width) >= 400))) {
          buckets.edges.push({
            depth: Math.max(best.depth, best.width),
            width: Math.min(best.depth, best.width),
            height: Math.max(1, Math.round(thick > 0 ? thick : 20)),
            score: 3,
            pkg: false,
          });
        }
      }
    }
    if (!buckets.weights.some((item) => !item.pkg)) {
      const weightRow = chars.find((row) => {
        const key = String(row.name || '')
          .toLowerCase()
          .replace(/ё/g, 'е');
        return /^(вес(?![а-яё])|вес,|вес товара|вес брутто|вес в упаков|вес нетто|масса(?![а-яё])|weight)/.test(key) && !/весь ozon|весы/.test(key);
      });
      if (weightRow) {
        const weight = readWeightGrams(
          /кг|kg/i.test(weightRow.name + ' ' + weightRow.value) ? weightRow.value + ' кг' : weightRow.value,
        );
        if (weight > 0) buckets.weights.push({ weight, score: 3, pkg: false });
      }
    }
  }

  function isDeliveryWidgetKey(key) {
    return /webDelivery|webOutOfStock|deliveryOptions|webShipping/i.test(String(key || ''));
  }

  function isRealDeliveryStateId(stateId) {
    return /^(webDelivery|webOutOfStock|webShipping)(?:-|$)/i.test(String(stateId || ''));
  }

  function expandDeliveryStateIds(stateIds) {
    const found = [];
    const add = (stateId) => {
      const id = String(stateId || '').trim();
      if (!id || found.indexOf(id) >= 0) return;
      found.push(id);
    };
    (stateIds || []).forEach((stateId) => {
      add(stateId);
      if (!isRealDeliveryStateId(stateId)) return;
      const idMatch = String(stateId).match(/-(\d+)(?:-|$)/);
      if (!idMatch) return;
      add('webDelivery-' + idMatch[1] + '-default-1');
      add('webSale-' + idMatch[1] + '-default-1');
    });
    return found;
  }

  /** webDelivery 组件里带着发货仓、时效等文本，抽出来作为上架/履约参考 */
  function collectDeliveryMeta(widget, buckets) {
    if (!widget || typeof widget !== 'object') return;
    const meta = buckets.meta || (buckets.meta = {});
    walk(
      widget,
      (obj) => {
        // title / text / subtitle 各自可能承载「发货仓」或「时效」，逐个看，不能相互遮蔽
        [obj.title, obj.text, obj.subtitle, obj.textAtom, obj.deliveryDate].forEach((raw) => {
          const text = specText(raw);
          if (!text || text.length > 160) return;
          if (!meta.deliveryWarehouse && /склад|warehouse|отправляет|отгруж/i.test(text)) {
            meta.deliveryWarehouse = text;
          }
          if (!meta.deliveryText && /доставк|привез|получ|дн(?:ей|я)|завтра|сегодня/i.test(text)) {
            meta.deliveryText = text;
          }
        });
      },
      0,
      '',
    );
  }

  function harvestWidgetStates(json, pageSku, buckets, imgUrls, opts) {
    const ws = json && json.widgetStates;
    if (!ws || typeof ws !== 'object') return;
    const forcePkgAll = Boolean(opts && opts.pkg);
    Object.keys(ws).forEach((key) => {
      if (isRecommendWidgetKey(key)) return;
      let widget = ws[key];
      if (typeof widget === 'string') {
        try {
          widget = JSON.parse(widget);
        } catch (_e) {
          harvestTextFallbacks(widget, pageSku, buckets);
          return;
        }
      }
      if (/webCurrentSeller/i.test(key) && widget && typeof widget === 'object') {
        const meta = buckets.meta || (buckets.meta = {});
        const seller = specText(
          widget.name ||
            (widget.sellerCell && widget.sellerCell.centerBlock && widget.sellerCell.centerBlock.title),
        );
        if (seller) meta.sellerName = seller;
        if (widget.id) meta.sellerId = String(widget.id);
      }
      if (/webBrand/i.test(key) && widget && typeof widget === 'object') {
        const meta = buckets.meta || (buckets.meta = {});
        const brand = specText(widget.name || widget.title || widget.brandName);
        if (brand) meta.brand = brand;
      }
      if (/webPrice|webSale/i.test(key) && widget && typeof widget === 'object') {
        const meta = buckets.meta || (buckets.meta = {});
        const card = Number(String(widget.cardPrice || widget.price || '').replace(/[^\d.]/g, ''));
        const original = Number(String(widget.originalPrice || widget.priceWithoutDiscount || '').replace(/[^\d.]/g, ''));
        const discount = Number(String(widget.marketingPrice || widget.discountPrice || '').replace(/[^\d.]/g, ''));
        if (card > 10 && card < 1e7) meta.price = card;
        if (original > 10 && original < 1e7) meta.originalPrice = original;
        if (discount > 10 && discount < 1e7) meta.discountPrice = discount;
      }
      if (isPdpGalleryWidgetKey(key)) {
        collectGalleryWidget(widget, imgUrls);
        collectVideo(widget, buckets);
      }
      const forcePkg = forcePkgAll || isDeliveryWidgetKey(key);
      if (isDeliveryWidgetKey(key)) collectDeliveryMeta(widget, buckets);
      const allowUnscoped = isTrustedDimWidgetKey(key);
      walk(
        widget,
        (obj, sku) => {
          collectDimsFromObject(obj, pageSku, buckets, sku, allowUnscoped, forcePkg);
          collectChars(obj, pageSku, buckets);
          collectMeta(obj, buckets);
          const tracked = obj.cellTrackingInfo && obj.cellTrackingInfo.product;
          if (tracked) {
            collectDimsFromObject(tracked, pageSku, buckets, skuOf(tracked) || sku, allowUnscoped, forcePkg);
            collectMeta(tracked, buckets);
          }
          if (typeof obj.widgetTrackingInfo === 'string') {
            harvestTextFallbacks(obj.widgetTrackingInfo, pageSku, buckets);
            try {
              walk(
                JSON.parse(obj.widgetTrackingInfo),
                (inner, innerSku) => collectDimsFromObject(inner, pageSku, buckets, innerSku, allowUnscoped, forcePkg),
                0,
                sku,
              );
            } catch (_e) {
              /* ignore */
            }
          }
        },
        0,
        '',
      );
    });
  }

  function ingestJson(json, text, pageSku, buckets, imgUrls, debug, opts) {
    probeText(text, debug);
    if (!json) {
      harvestTextFallbacks(text, pageSku, buckets);
      return;
    }
    harvestWidgetStates(json, pageSku, buckets, imgUrls, opts);
    ingestNamedWidgets(json, pageSku, buckets, imgUrls);
    harvestTextFallbacks(text, pageSku, buckets);
  }

  function pickBest(items) {
    return items.slice().sort((a, b) => b.score - a.score)[0];
  }

  /** 字典命中的属性各取第一个非空值，作为上架必填项的稳定来源 */
  function canonicalAttrs(buckets) {
    const attrs = {};
    const meta = buckets.meta || {};
    (buckets.chars || []).forEach((row) => {
      const out = canonicalAttrName(row.name);
      const value = String(row.value == null ? '' : row.value).replace(/\s+/g, ' ').trim();
      if (!out || !value || value.length > 400 || attrs[out]) return;
      attrs[out] = value;
    });
    if (!attrs['Бренд'] && meta.brand) attrs['Бренд'] = meta.brand;
    return attrs;
  }

  function toDimSpecs(buckets) {
    const specs = [];
    const productEdge = pickBest(buckets.edges.filter((item) => !item.pkg));
    const packageEdge = pickBest(buckets.edges.filter((item) => item.pkg));
    const productWeight = pickBest(buckets.weights.filter((item) => !item.pkg));
    const packageWeight = pickBest(buckets.weights.filter((item) => item.pkg));
    // 边长两个口径可以互相兜底（服务端取最大值）；重量不能兜底，
    // 否则毛重会被当成净重再加一次包装余量、净重会被当成毛重少加一次
    const edge = productEdge || packageEdge;
    if (edge) {
      specs.push(
        { name: 'Длина, мм', value: String(Math.round(edge.depth)) },
        { name: 'Ширина, мм', value: String(Math.round(edge.width)) },
      );
      if (edge.height > 0) specs.push({ name: 'Высота, мм', value: String(Math.round(edge.height)) });
    }
    if (productWeight) {
      specs.push({ name: 'Вес товара, г', value: String(Math.round(productWeight.weight)) });
    }
    const pkgEdge = packageEdge || productEdge;
    if (pkgEdge) {
      specs.push(
        { name: 'Длина упаковки, мм', value: String(Math.round(pkgEdge.depth)) },
        { name: 'Ширина упаковки, мм', value: String(Math.round(pkgEdge.width)) },
        { name: 'Высота упаковки, мм', value: String(Math.round(pkgEdge.height)) },
      );
    }
    if (packageWeight) {
      specs.push({ name: 'Вес брутто, г', value: String(Math.round(packageWeight.weight)) });
    }
    const attrs = canonicalAttrs(buckets);
    Object.keys(attrs).forEach((name) => {
      if (specs.some((item) => item.name === name)) return;
      specs.push({ name, value: attrs[name] });
    });
    buckets.chars
      .slice()
      .sort((a, b) => b.score - a.score)
      .forEach((row) => {
        if (specs.some((item) => item.name === row.name)) return;
        specs.push({ name: row.name, value: row.value });
      });
    return specs;
  }

  function collectLayoutWidgets(nodes, found, depth) {
    if ((depth || 0) > 18 || nodes == null) return;
    if (Array.isArray(nodes)) {
      nodes.forEach((item) => collectLayoutWidgets(item, found, (depth || 0) + 1));
      return;
    }
    if (typeof nodes !== 'object') return;
    const component = String(nodes.component || nodes.name || nodes.widgetName || '');
    const place = String(nodes.place || '');
    const ids = [];
    if (nodes.stateId) ids.push(String(nodes.stateId));
    else if (component && nodes.id != null) {
      ids.push(component + '-' + nodes.id + '-default-1');
      if (place) ids.push(component + '-' + nodes.id + '-' + place);
      ids.push(component + '-' + nodes.id + '-pdpPage2column-2');
    }
      const important =
      /webCharacteristics|webShortCharacteristics|webDescription|webSale|webGallery|webAspects|webCurrentSeller|webBrand|webPrice|webDetailSKU|webDelivery|webOutOfStock|webProductHeading|webSingleProductScore|webQuestionCount|webAnnotation|webRichAnnotation|webProductMainWidget/i.test(
        component + ' ' + ids.join(' '),
      );
    const skip = isRecommendWidgetKey(component) || ids.some((id) => isRecommendWidgetKey(id));
    if (!skip) {
      ids.forEach((stateId) => {
        if (!stateId) return;
        if (!(important || nodes.asyncData)) return;
        const existing = found.find((item) => item.stateId === stateId);
        if (existing) {
          // widgetStates 里的 webDelivery 常是 {}，asyncData 只在 layout 节点上。
          // 先登记空壳再遇到 layout 时必须回填，否则 POST 会 400。
          if ((existing.asyncData == null || existing.asyncData === '') && nodes.asyncData != null && nodes.asyncData !== '') {
            existing.asyncData = nodes.asyncData;
          }
          if (important) existing.important = true;
          return;
        }
        found.push({
          stateId,
          asyncData: nodes.asyncData != null ? nodes.asyncData : '',
          component: component || stateId.split('-')[0],
          important: Boolean(important),
        });
      });
    }
    Object.keys(nodes).forEach((key) => {
      if (key === 'widgetStates' || key === 'asyncData') return;
      const value = nodes[key];
      if (value && typeof value === 'object') collectLayoutWidgets(value, found, (depth || 0) + 1);
    });
  }

  async function fetchText(url, init) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
    }, 8000);
    try {
      const res = await fetch(url, Object.assign({ credentials: 'include' }, init || {}, ctrl ? { signal: ctrl.signal } : {}));
      const text = await res.text();
      return { url, ok: res.ok, status: res.status, bytes: text.length, text };
    } catch (error) {
      return { url, ok: false, status: 0, bytes: 0, text: '', error: String(error && error.message ? error.message : error) };
    } finally {
      clearTimeout(timer);
    }
  }

  function parseMaybe(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_e) {
      return null;
    }
  }

  function attrOr(attrs, name, fallback) {
    const value = attrs && attrs[name] ? String(attrs[name]).trim() : '';
    return value || String(fallback || '').trim();
  }

  async function harvestOzon(productPath, pageSku) {
      const report = { dimSpecs: [], attrs: {}, imgUrls: [], fetches: [], error: '', pageCount: 0, debug: [] };
      try {
      const origin = location.origin || 'https://www.ozon.ru';
      const skuMatch = String(pageSku || location.pathname || '').match(/(\d{6,})/);
      const sku = skuMatch ? skuMatch[1] : '';
      const path =
        (location.pathname && /\/product\//i.test(location.pathname)
          ? location.pathname.endsWith('/')
            ? location.pathname
            : location.pathname + '/'
          : '') ||
        productPath ||
        (sku ? '/product/' + sku + '/' : '/');
      const search = location.search || '';
      const entry = origin + '/api/entrypoint-api.bx/page/json/v2?url=';
      const composer = origin + '/api/composer-api.bx/page/json/v2?url=';
      function withParams(extra) {
        const qs = new URLSearchParams(String(search || '').replace(/^\?/, ''));
        Object.keys(extra || {}).forEach((key) => qs.set(key, extra[key]));
        const query = qs.toString();
        return entry + encodeURIComponent(path + (query ? '?' + query : ''));
      }
      // Seerfar uses unencoded sibling params: url=/product/{sku}/?layout_container=... becomes
      // url=/product/{sku}/ & layout_container=pdpPage2column & layout_page_index=2
      const composerPage = origin + '/api/composer-api.bx/page/json/v2?url=';
      const pageUrls = sku
        ? [
            composerPage + '/product/' + sku + '/',
            composerPage + '/product/' + sku + '/?layout_container=pdpPage2column&layout_page_index=2',
            composerPage + encodeURIComponent('/product/' + sku + '/'),
            composerPage + encodeURIComponent(
              '/product/' + sku + '/?layout_container=pdpPage2column&layout_page_index=2',
            ),
            entry + '/product/' + sku + '/?oos_search=false',
            entry + '/product/' + sku + '/?layout_container=pdpPage2column&layout_page_index=2&oos_search=false',
            withParams({ layout_container: 'pdpPage2column', layout_page_index: '2', oos_search: 'false' }),
          ]
        : [composer + encodeURIComponent(path)];
      // Seerfar 用的三个 modal：变体、尺码表、其他卖家报价，都带完整特性/尺寸
      const modalUrls = sku
        ? [
            entry + '/modal/aspectsNew?product_id=' + sku + '&page_changed=true',
            entry + '/modal/size-table?product_id=' + sku + '&page_changed=true',
            entry + encodeURIComponent('/modal/size-table?product_id=' + sku + '&page_changed=true'),
            entry + '/modal/otherOffersFromSellers?product_id=' + sku + '&page_changed=true',
            entry + '/modal/delivery?product_id=' + sku + '&page_changed=true',
          ]
        : [];
      const buckets = { edges: [], weights: [], chars: [], charNames: [], meta: {} };
      const imgUrls = [];
      const layoutWidgets = [];
      const seen = {};
      function rememberWidget(stateId, asyncData, component, important) {
        if (!stateId) return;
        const existing = layoutWidgets.find((item) => item.stateId === stateId);
        if (existing) {
          if ((existing.asyncData == null || existing.asyncData === '') && asyncData != null && asyncData !== '') {
            existing.asyncData = asyncData;
          }
          if (important) existing.important = true;
          return;
        }
        layoutWidgets.push({
          stateId,
          asyncData: asyncData != null ? asyncData : '',
          component: component || String(stateId).split('-')[0],
          important: Boolean(important),
        });
      }
      function takeWidgetStates(json) {
        const ws = json && json.widgetStates;
        if (!ws || typeof ws !== 'object') return;
        Object.keys(ws).forEach((key) => {
          if (!isTrustedDimWidgetKey(key) && !isDeliveryWidgetKey(key)) return;
          let widget = ws[key];
          if (typeof widget === 'string') {
            try {
              widget = JSON.parse(widget);
            } catch (_e) {
              widget = null;
            }
          }
          const asyncData = widget && widget.asyncData != null ? widget.asyncData : '';
          rememberWidget(key, asyncData, key.split('-')[0], true);
        });
      }
      function expandQueuedDeliveries() {
        const current = layoutWidgets.filter((item) => isRealDeliveryStateId(item.stateId)).map((item) => item.stateId);
        expandDeliveryStateIds(current).forEach((stateId) => {
          const source = layoutWidgets.find((item) => item.stateId === stateId) ||
            layoutWidgets.find((item) => isRealDeliveryStateId(item.stateId) && item.asyncData);
          rememberWidget(stateId, source && source.asyncData, stateId.split('-')[0], isRealDeliveryStateId(stateId));
        });
      }
      function takeSeerfarDeliveries(layout) {
        // 对齐 seerfar getOzonComponent(container, 'webDelivery')：只认 layout.component，
        // 用节点自己的 id + asyncData，不从 widgetStates 空壳取。
        const walk = (node, depth) => {
          if ((depth || 0) > 24 || !node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            node.forEach((item) => walk(item, (depth || 0) + 1));
            return;
          }
          const component = String(node.component || '');
          if (/^webDelivery$|^webOutOfStock$|^webShipping$/i.test(component)) {
            const stateId = node.stateId || (node.id != null ? component + '-' + node.id + '-default-1' : '');
            if (stateId) rememberWidget(stateId, node.asyncData, component, true);
          }
          Object.keys(node).forEach((key) => {
            if (key === 'widgetStates' || key === 'asyncData') return;
            walk(node[key], (depth || 0) + 1);
          });
        };
        walk(layout, 0);
      }
      function takeLayout(json) {
        if (!json) return;
        if (json.layout != null) {
          takeSeerfarDeliveries(json.layout);
          collectLayoutWidgets(json.layout, layoutWidgets, 0);
        } else {
          takeSeerfarDeliveries(json);
          collectLayoutWidgets(json, layoutWidgets, 0);
        }
        takeWidgetStates(json);
        expandQueuedDeliveries();
      }
      function safeIngest(json, text, opts) {
        try {
          takeLayout(json);
          ingestJson(json, text, sku, buckets, imgUrls, report.debug, opts);
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          report.error = report.error ? report.error + '; ' + message : message;
        }
      }
      try {
        const nuxt = window.__NUXT__ && window.__NUXT__.state;
        if (nuxt) {
          takeLayout(nuxt);
          safeIngest({ layout: nuxt.layout, widgetStates: nuxt.widgetStates || {} }, '');
        }
      } catch (_e) {
        /* ignore */
      }
      (Array.isArray(global.__aiecomOzonFetchCache) ? global.__aiecomOzonFetchCache : []).forEach((item) => {
        if (!item || !item.text || item.ok === false) return;
        const json = parseMaybe(item.text);
        if (!json) return;
        report.fetches.push({
          status: item.status || 200,
          ok: true,
          bytes: String(item.text).length,
          error: '',
          path: 'cache:' + String(item.url || '').replace(origin, '').slice(0, 80),
          widgets: json.widgetStates ? Object.keys(json.widgetStates).slice(0, 6).join(',') : '',
        });
        report.pageCount += 1;
        safeIngest(json, item.text);
      });
      const pendingPages = pageUrls.concat(modalUrls).filter((url) => {
        if (seen[url]) return false;
        seen[url] = true;
        return true;
      });
      for (let i = 0; i < pendingPages.length; i += 4) {
        const batch = await Promise.all(
          pendingPages.slice(i, i + 4).map((pageUrl) => fetchText(pageUrl, { headers: { accept: 'application/json' } })),
        );
        batch.forEach((fetched) => {
          const json = fetched.ok && !/incidentId|challengeURL/.test(fetched.text || '') ? parseMaybe(fetched.text) : null;
          const widgetKeys =
            json && json.widgetStates && typeof json.widgetStates === 'object' ? Object.keys(json.widgetStates) : [];
          const interesting = widgetKeys.filter((key) =>
            /charact|descript|sale|galler|aspect|seller|brand|price|deliver|heading|detailSKU|question|annot/i.test(key),
          );
          report.fetches.push({
            status: fetched.status,
            ok: fetched.ok,
            bytes: fetched.bytes,
            error: fetched.error || '',
            path: String(fetched.url || '').replace(origin, '').slice(0, 96),
            widgets: (interesting.length ? interesting : widgetKeys.slice(0, 8)).join(','),
            widgetCount: widgetKeys.length,
          });
          if (!fetched.ok) return;
          if (/incidentId|challengeURL/.test(fetched.text || '')) {
            report.fetches[report.fetches.length - 1].error = 'antibot';
            return;
          }
          report.pageCount += 1;
          safeIngest(json, fetched.text);
        });
      }
      const widgetRank = (item) => {
        const key = String(item.component || item.stateId || '');
        if (isRealDeliveryStateId(item.stateId) || /^(webDelivery|webOutOfStock|webShipping)$/i.test(item.component || '')) {
          return item.asyncData ? 7 : 6;
        }
        if (/webCharacteristics|webShortCharacteristics/i.test(key)) return 5;
        if (/webDescription|webAnnotation|webSale/i.test(key)) return 4;
        if (/webGallery|webAspects|webCurrentSeller|webBrand|webPrice/i.test(key)) return 3;
        return item.important ? 2 : 1;
      };
      layoutWidgets.sort((a, b) => widgetRank(b) - widgetRank(a));
      const deliveries = layoutWidgets.filter(
        (item) => isRealDeliveryStateId(item.stateId) || /^(webDelivery|webOutOfStock|webShipping)$/i.test(item.component || ''),
      );
      const others = layoutWidgets.filter(
        (item) => item.important && !deliveries.some((delivery) => delivery.stateId === item.stateId),
      );
      const widgetBatch = deliveries.concat(others).slice(0, 24);
      report.queuedWidgets = widgetBatch.map((item) => {
        const raw = item.asyncData;
        const asyncLen =
          raw == null || raw === ''
            ? 0
            : String(typeof raw === 'string' ? raw : JSON.stringify(raw)).length;
        return item.stateId + (asyncLen ? '(async:' + asyncLen + ')' : '(no-async)');
      });
      async function postWidget(widget, asyncData) {
        return fetchText(origin + '/api/composer-api.bx/widget/json/v2?widgetStateId=' + encodeURIComponent(widget.stateId), {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ asyncData: asyncData != null ? asyncData : '' }),
        });
      }
      for (let i = 0; i < widgetBatch.length; i += 4) {
        const chunk = widgetBatch.slice(i, i + 4);
        const results = await Promise.all(chunk.map((widget) => postWidget(widget, widget.asyncData)));
        for (let idx = 0; idx < results.length; idx += 1) {
          let fetched = results[idx];
          const widget = chunk[idx];
          const isDelivery =
            isRealDeliveryStateId(widget.stateId) ||
            /^(webDelivery|webOutOfStock|webShipping)$/i.test(widget.component || '');
          if (isDelivery && (widget.asyncData == null || widget.asyncData === '')) {
            fetched = { status: 0, ok: false, bytes: 0, text: '', error: 'missing-layout-asyncData' };
          }
          report.fetches.push({
            status: fetched.status,
            ok: fetched.ok,
            bytes: fetched.bytes,
            error: fetched.error || '',
            path: (widget.component || widget.stateId).slice(0, 64),
            widgets: widget.stateId.slice(0, 80),
          });
          if (fetched.ok && !/incidentId|challengeURL/.test(fetched.text || '')) {
            report.pageCount += 1;
            safeIngest(parseMaybe(fetched.text), fetched.text, isDelivery ? { pkg: true } : undefined);
          } else if (fetched.ok) {
            report.fetches[report.fetches.length - 1].error = 'antibot';
          }
        }
      }
      const deliveryDeadline = Date.now() + 2500;
      while (
        Date.now() < deliveryDeadline &&
        !document.querySelector('[id^="state-webDelivery-"], [data-widget="webDelivery"]')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      document.querySelectorAll('[data-state]').forEach((node) => {
        const raw = node.getAttribute('data-state') || '';
        const widgetId = String(node.id || node.getAttribute('data-widget') || '');
        safeIngest(parseMaybe(raw), raw, isDeliveryWidgetKey(widgetId) ? { pkg: true } : undefined);
      });
      function scrapePairs(root) {
        if (!root) return;
        root.querySelectorAll('dt').forEach((dt) => {
          const name = specText(dt.textContent);
          const value = specText(dt.nextElementSibling && dt.nextElementSibling.textContent);
          if (name && value) {
            if (buckets.charNames.length < 80 && buckets.charNames.indexOf(name) < 0) buckets.charNames.push(name);
            buckets.chars.push({ name, value, score: isDimCharName(name) ? 2 : 0 });
          }
        });
        root.querySelectorAll('tr').forEach((tr) => {
          const cells = tr.querySelectorAll('td, th');
          if (cells.length < 2) return;
          const name = specText(cells[0].textContent);
          const value = specText(cells[1].textContent);
          if (name && value) {
            if (buckets.charNames.length < 80 && buckets.charNames.indexOf(name) < 0) buckets.charNames.push(name);
            buckets.chars.push({ name, value, score: isDimCharName(name) ? 2 : 0 });
          }
        });
        collectLabeledText(root.innerText || '', buckets);
      }
      scrapePairs(document.getElementById('section-characteristics'));
      scrapePairs(document.querySelector('[data-widget="webCharacteristics"]'));
      scrapePairs(document.querySelector('[data-widget="webShortCharacteristics"]'));
      const descRoot =
        document.getElementById('section-description') ||
        document.querySelector('[data-widget="webDescription"], [data-widget="webProductDescription"]');
      if (descRoot && descRoot.innerText) {
        collectLabeledText(descRoot.innerText, buckets);
        if (!buckets.meta.description && descRoot.innerText.trim().length > 40) {
          buckets.meta.description = descRoot.innerText.trim().slice(0, 8000);
        }
      }
      const sellerRoot = document.querySelector('[data-widget="webCurrentSeller"]');
      if (sellerRoot && !buckets.meta.sellerName) {
        const seller = specText(sellerRoot.innerText).split(/[\n•]/)[0];
        if (seller && seller.length < 80) buckets.meta.sellerName = seller;
      }
      const brandRoot = document.querySelector('[data-widget="webBrand"]');
      if (brandRoot && !buckets.meta.brand) {
        const brand = specText(brandRoot.innerText).split(/[\n•]/)[0];
        // webBrand 常只渲染「Бренд проверен」这类角标文案，不是品牌名
        if (brand && brand.length < 80 && !/^бренд|^brand\b|проверен/i.test(brand)) buckets.meta.brand = brand;
      }
      if (!buckets.meta.rating) {
        const scoreRoot = document.querySelector('[data-widget="webSingleProductScore"]');
        const score = scoreRoot ? Number((scoreRoot.innerText.match(/(\d[.,]\d)/) || [])[1]?.replace(',', '.')) : 0;
        if (Number.isFinite(score) && score > 0 && score <= 5) buckets.meta.rating = score;
      }
      const meta = buckets.meta || {};
      if (meta.sellerName) buckets.chars.push({ name: 'Продавец', value: meta.sellerName, score: 0 });
      if (meta.sellerId) buckets.chars.push({ name: 'ID продавца', value: String(meta.sellerId), score: 0 });
      if (meta.brand) buckets.chars.push({ name: 'Бренд', value: meta.brand, score: 0 });
      if (meta.categoryPath) buckets.chars.push({ name: 'Категория', value: meta.categoryPath, score: 0 });
      applyPackageFromChars(buckets);
      applyWarehouseFromChars(buckets);
      report.dimSpecs = toDimSpecs(buckets).slice(0, 160);
      report.attrs = canonicalAttrs(buckets);
      report.imgUrls = imgUrls.filter(isProductImageUrl).slice(0, 30);
      report.charNames = (buckets.charNames || []).slice(0, 80);
      report.meta = {
        brand: attrOr(report.attrs, 'Бренд', meta.brand),
        description: meta.description || '',
        sellerName: meta.sellerName || '',
        sellerId: meta.sellerId || '',
        rating: meta.rating || 0,
        reviewCount: meta.reviewCount || 0,
        categoryPath: meta.categoryPath || '',
        originalPrice: meta.originalPrice || 0,
        discountPrice: meta.discountPrice || 0,
        price: meta.price || 0,
        videoUrls: Array.isArray(meta.videoUrls) ? meta.videoUrls.slice(0, 8) : [],
        deliveryWarehouse: meta.deliveryWarehouse || '',
        deliveryText: meta.deliveryText || '',
      };
      if (report.charNames.length && report.debug.length < 12) {
        report.debug.push({ key: 'chars', snippet: report.charNames.join(' | ').slice(0, 240) });
      }
      if (Array.isArray(report.queuedWidgets) && report.queuedWidgets.length && report.debug.length < 12) {
        report.debug.push({ key: 'queued', snippet: report.queuedWidgets.join(', ').slice(0, 240) });
      }
      const hasPkg = (report.dimSpecs || []).some((item) =>
        /упаковк|брутто|длина,\s*мм|ширина,\s*мм|высота,\s*мм|вес товара/i.test(String(item.name || '')),
      );
      if (!hasPkg && report.debug.length < 12) {
        report.debug.push({
          key: 'delivery',
          snippet: 'Ozon public widgets had no dimension/weight; seerfar overlay is not on this PDP',
        });
      }
    } catch (error) {
      report.error = String(error && error.message ? error.message : error);
    }
    try {
      return JSON.parse(JSON.stringify(report));
    } catch (error) {
      return {
        dimSpecs: [],
        attrs: {},
        imgUrls: [],
        fetches: [],
        error: 'serialize: ' + String(error && error.message ? error.message : error) + (report.error ? '; ' + report.error : ''),
        pageCount: Number(report.pageCount) || 0,
        debug: [],
        charNames: Array.isArray(report.charNames) ? report.charNames.slice(0, 40) : [],
        meta: {},
      };
    }
  }

  global.__aiecomHarvestOzon = harvestOzon;
})(typeof window !== 'undefined' ? window : globalThis);
