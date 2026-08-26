function isChallengePage() {
  const title = document.title || '';
  const heading = (document.querySelector('h1') && document.querySelector('h1').textContent) || '';
  const visible = document.body && document.body.innerText ? document.body.innerText.slice(0, 4000) : '';
  return /доступ ограничен|подтвердите[\s\S]{0,40}не робот|are you a robot|just a moment|access denied|cf-challenge/i.test(
    [title, heading, visible].join('\n'),
  );
}

function isListingLocation() {
  const path = location.pathname || '';
  return /\/(category|search|highlight)\//i.test(path) || path === '/search' || path === '/search/';
}

function extractListing(limit) {
  const cap = Number(limit) > 0 ? Number(limit) : 50;
  const html = document.documentElement ? document.documentElement.innerHTML : '';
  const urls = [];
  const seen = {};
  const re = /\/product\/(?:[a-z0-9\-._%]+-)?(\d{6,})/gi;
  let match;
  while ((match = re.exec(html))) {
    if (seen[match[1]] || /mock-/i.test(match[0])) continue;
    seen[match[1]] = true;
    const path = match[0].split('?')[0];
    urls.push('https://www.ozon.ru' + (path.charAt(0) === '/' ? path : '/' + path).replace(/\/?$/, '/'));
    if (urls.length >= cap) break;
  }
  return {
    kind: 'listing',
    urls,
    blocked: isChallengePage() && urls.length === 0,
    sourceUrl: location.href,
  };
}

function parsePrice(raw) {
  if (typeof raw === 'number' && isFinite(raw) && raw > 0) return raw;
  const compact = String(raw || '')
    .replace(/[^\d,.\s]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!compact) return 0;
  if (/^\d+,\d{1,2}$/.test(compact)) return Number(compact.replace(',', '.')) || 0;
  if (/^\d+\.\d{1,2}$/.test(compact)) return Number(compact) || 0;
  const n = Number(compact.replace(/[.,]/g, '')) || 0;
  return n >= 10 && n <= 1000000 ? n : 0;
}

function normalizeImage(raw) {
  if (!raw) return null;
  let url = String(raw)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) return null;
  if (!/ozone\.ru|ozonusercontent\.com|cdn\d*\.ozon\.ru/i.test(url)) return null;
  if (/\.(svg|gif)(\?|$)/i.test(url) || /favicon|sprite|logo|pixel|1x1|avatar/i.test(url)) return null;
  return url.replace(/\/wc(?:18|28|50|75|100|200|240|400)\//i, '/wc1200/').split('#')[0];
}

function isGalleryImage(url) {
  if (!url) return false;
  if (/\/cms\/|\/graphics\/|\/icons?\/|\/static\/|\/promo\//i.test(url)) return false;
  if (/(?:^|[/-])(?:logo|icon|badge|banner|sprite|avatar|favicon|payment|flame)(?:[/-]|\.|$)/i.test(url)) return false;
  return /\/s3\/multimedia/i.test(url);
}

function uniqueImages(urls) {
  const best = {};
  urls.forEach((item) => {
    const url = normalizeImage(item);
    if (!url || !isGalleryImage(url)) return;
    const key = (url.match(/multimedia[^/]*\/(?:wc\d+\/)?([^/?]+)/i) || [null, url])[1];
    const rank = /\/wc(?:1200|2000|2500)\//i.test(url)
      ? 4
      : /\/wc1000\//i.test(url)
        ? 3
        : /\/multimedia/i.test(url) && !/\/wc\d+\//i.test(url)
          ? 5
          : 1;
    if (!best[key] || rank > best[key].rank) best[key] = { url, rank };
  });
  return Object.keys(best)
    .map((k) => best[k])
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 30)
    .map((item) => item.url);
}

function cleanAspectChip(raw) {
  let text = String(raw || '')
    .replace(/выгода\s*\d+\s*%/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s+[\d,.]+ *[₽¥].*$/u, '').trim();
  text = text.replace(/\s*\/\s*100.*$/i, '').trim();
  const leadNum = text.match(/^(\d{2,5})(?:\s|$)/);
  if (leadNum) return leadNum[1];
  const token = text.split('\n')[0].trim().split(' ')[0] || '';
  if (
    !token ||
    token.length > 80 ||
    /^https?:/i.test(token) ||
    /[₽¥]/u.test(token) ||
    /выгода/i.test(token) ||
    /^\d+[,.]\d+$/.test(token)
  ) {
    return '';
  }
  return token;
}

function isSpecAspectName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n || /покупают вместе|похожие|рекоменд|смотрели|хиты продаж|вам понрав|другие товар|популярн/i.test(n)) return false;
  return /вес|вкус|цвет|размер|объ[её]м|фасовка|количест|рост|обхват|длин|ширин|высот|модель|комплект|штук|название|аромат|плотность|состав|покрой|рукав|вырез|застежк|color|size|qty|variant/i.test(
    n,
  );
}

function listingSlugFamily(urlOrSlug) {
  const path = String(urlOrSlug || '').split('?')[0].toLowerCase();
  const slug =
    (path.match(/\/product\/([a-z0-9\-._%]+)-\d{6,}/i) || [])[1] ||
    path.replace(/^.*\//, '').replace(/-\d{6,}$/, '');
  const parts = String(slug)
    .replace(/-\d{2,5}-g(?:r)?$/i, '')
    .replace(/-1-kg$/i, '')
    .replace(/-\d+-kg$/i, '')
    .replace(/-\d+-shtuk[ia]?$/i, '')
    .replace(/-\d+-sht$/i, '')
    .replace(/-\d+-pieces?$/i, '')
    .split('-')
    .filter(Boolean);
  if (parts.length >= 3) parts.pop();
  return parts.join('-');
}

function inferWeightFrom(name, sourceUrl) {
  const blob = String(name || '') + ' ' + String(sourceUrl || '');
  if (/\b1(?:[.,]0)?\s*кг|\b1-kg\b|\b1000[\s-]*g\b/i.test(blob)) return '1000';
  const grams = blob.match(/(\d{2,4})\s*г(?![а-яё])/i) || blob.match(/(\d{2,4})-g\b/i);
  return grams ? grams[1] : '';
}

function aspectChipValue(rec) {
  const data = (rec && rec.data) || {};
  const content = (data && data.content) || rec.content || {};
  const title = typeof rec.title === 'object' && rec.title ? rec.title : data.title;
  const parts = [
    rec.key,
    rec.value,
    rec.text,
    rec.searchableText,
    rec.name,
    rec.label,
    rec.subtitle,
    rec.caption,
    rec.ariaLabel,
    rec['aria-label'],
    rec.alt,
    rec.color,
    rec.colorName,
    rec.content,
    data.text,
    data.value,
    data.name,
    data.key,
    data.ariaLabel,
    data.alt,
    data.color,
    content.text,
    title && title.text,
    typeof rec.title === 'string' ? rec.title : '',
    typeof data.title === 'string' ? data.title : '',
  ];
  const cleaned = parts.map((item) => cleanAspectChip(item)).filter(Boolean);
  const numeric = cleaned.find((item) => /^\d{2,5}$/.test(item));
  if (numeric) return numeric;
  const joined = cleanAspectChip(parts.filter((item) => item != null && item !== '').join(' '));
  return joined || cleaned[0] || '';
}

function extractProductHref(rec, depth) {
  if (depth > 4 || rec == null) return '';
  if (typeof rec === 'string') {
    const match = rec.match(/https?:\/\/[^"' \s<>]*ozon\.ru\/product\/[^"'?\s<>]+/i) || rec.match(/\/product\/[a-z0-9\-._%]+/i);
    return match ? match[0] : '';
  }
  if (typeof rec !== 'object') return '';
  const keys = ['link', 'href', 'url', 'deepLink', 'relativeUrl', 'canonicalUrl', 'pathname', 'action', 'clickUrl', 'targetUrl'];
  for (let i = 0; i < keys.length; i += 1) {
    const found = extractProductHref(rec[keys[i]], (depth || 0) + 1);
    if (found) return found;
  }
  return extractProductHref(rec.data, (depth || 0) + 1);
}

function rememberGroupName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .split(':')[0]
    .replace(/:$/, '')
    .trim();
}

function asSku(value) {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  const text = String(value || '').trim();
  if (!text) return '';
  const path = text.split('?')[0].split('#')[0];
  const slug = path.match(/-(\d{6,})\/?$/);
  if (slug) return slug[1];
  const match = path.match(/(\d{6,})/g);
  return match ? match[match.length - 1] : '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

function extractObjectAt(source, start) {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < Math.min(source.length, start + 6000000); i += 1) {
    const ch = source[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return parseJson(source.slice(start, i + 1));
    }
  }
  return null;
}

function walk(node, visit, depth) {
  if (depth > 18 || node == null) return;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length > 8) {
      const parsed = parseJson(trimmed);
      if (parsed) walk(parsed, visit, depth + 1);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  Object.keys(node).forEach((key) => walk(node[key], visit, depth + 1));
}

function collectTrees(html) {
  const trees = [];
  const marker = html.indexOf('"widgetStates"');
  if (marker >= 0) {
    const brace = html.indexOf('{', marker);
    const parsed = brace >= 0 ? extractObjectAt(html, brace) : null;
    if (parsed) trees.push(parsed);
  }
  document.querySelectorAll('script[type="application/json"]').forEach((node) => {
    const parsed = parseJson(node.textContent || '');
    if (parsed) trees.push(parsed);
  });
  return trees;
}

function addSpec(specs, name, value) {
  const n = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  const v = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n || !v || n.length > 80 || v.length > 800 || n === '商品描述') return;
  if (specs.some((item) => item.name === n && item.value === v)) return;
  specs.push({ name: n, value: v });
}

function extract() {
  const jsonLdNodes = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    const parsed = parseJson(node.textContent || 'null');
    const items = Array.isArray(parsed) ? parsed : [parsed];
    items.forEach((item) => {
      if (item && (item['@type'] === 'Product' || item.name)) jsonLdNodes.push(item);
    });
  });
  const jsonLd = jsonLdNodes[0] || {};
  const html = (document.documentElement ? document.documentElement.innerHTML : '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
  const trees = collectTrees(html);

  const name =
    jsonLd.name ||
    (document.querySelector('h1') && document.querySelector('h1').textContent.trim()) ||
    (document.querySelector('[data-widget="webProductHeading"]') &&
      document.querySelector('[data-widget="webProductHeading"]').textContent.trim()) ||
    document.title;
  const sku =
    jsonLd.sku ||
    jsonLd.productID ||
    (document.querySelector('meta[itemprop="sku"]') &&
      document.querySelector('meta[itemprop="sku"]').getAttribute('content')) ||
    (location.pathname.match(/(\d{6,})/) || [null, ''])[1];

  const urls = [];
  const videos = [];
  const variantsMap = {};
  const specs = [];
  let treePrice = 0;
  let originalPrice = 0;
  let discountPrice = 0;
  let description = String(jsonLd.description || '').trim();
  let brand = '';
  if (typeof jsonLd.brand === 'string' && jsonLd.brand.trim()) brand = jsonLd.brand.trim();
  else if (jsonLd.brand && typeof jsonLd.brand.name === 'string') brand = jsonLd.brand.name.trim();

  function rememberVariant(groupName, rec) {
    rec = rec || {};
    const data = rec.data || {};
    let value = aspectChipValue(rec);
    groupName = rememberGroupName(groupName);
    const link = extractProductHref(rec.link) || extractProductHref(rec.href) || extractProductHref(rec.url) || extractProductHref(rec.action) || extractProductHref(data);
    const sourceUrl = link
      ? link.indexOf('http') === 0
        ? link.split('?')[0]
        : 'https://www.ozon.ru' + (link.charAt(0) === '/' ? link : '/' + link)
      : undefined;
    const skuId = asSku(sourceUrl) || asSku(rec.sku || rec.skuId || data.sku) || undefined;
    if (!value) value = inferWeightFrom(rec.searchableText || rec.title || '', sourceUrl || '');
    if (!value && (skuId || rec.image || rec.src || (data && data.image))) {
      value = cleanAspectChip(rec.ariaLabel || rec['aria-label'] || rec.alt || data.alt || '') || (skuId ? 'вариант ' + skuId : '');
    }
    if (!groupName || !isSpecAspectName(groupName) || !value) return;
    if (!variantsMap[groupName]) variantsMap[groupName] = { name: groupName, values: [] };
    if (variantsMap[groupName].values.some((item) => item.value === value)) return;
    const swatch = rec.image || rec.src || rec.preview || (data && (data.image || data.src));
    variantsMap[groupName].values.push({
      value,
      selected: Boolean(rec.isSelected || rec.selected || rec.active || rec.checked || data.active),
      skuId,
      sourceUrl: sourceUrl || (skuId ? 'https://www.ozon.ru/product/' + skuId + '/' : undefined),
      price: parsePrice(rec.price || rec.cardPrice) || undefined,
      imageUrls: typeof swatch === 'string' ? [swatch] : swatch && swatch.src ? [swatch.src] : undefined,
    });
  }

  trees.forEach((tree) => {
    walk(
      tree,
      (obj) => {
        if (Array.isArray(obj.images)) {
          obj.images.forEach((item) => {
            if (typeof item === 'string') urls.push(item);
            else if (item) {
              const w = Number(item.width || item.w);
              const h = Number(item.height || item.h);
              if (Number.isFinite(w) && Number.isFinite(h) && Math.max(w, h) > 0 && Math.max(w, h) < 200) return;
              if (/logo|icon|badge|banner|payment/i.test(String(item.type || item.kind || item.role || ''))) return;
              if (item.original) urls.push(item.original);
              if (item.src) urls.push(item.src);
            }
          });
        }
        if (typeof obj.videoUrl === 'string') videos.push(obj.videoUrl);
        if (Array.isArray(obj.aspects) || Array.isArray(obj.aspectList) || Array.isArray(obj.skuAspects)) {
          (obj.aspects || obj.aspectList || obj.skuAspects).forEach((aspect) => {
            const data = aspect && aspect.data;
            const groupName = String(
              (aspect && (aspect.name || aspect.title || aspect.key || aspect.aspectName)) || (data && data.title) || '',
            ).trim();
            const values =
              (aspect &&
                (aspect.aspectValues ||
                  aspect.values ||
                  aspect.items ||
                  aspect.variants ||
                  aspect.options ||
                  aspect.buttons ||
                  aspect.pills ||
                  aspect.rs ||
                  aspect.cs)) ||
              [];
            if (isSpecAspectName(groupName) && Array.isArray(values)) values.forEach((item) => rememberVariant(groupName, item || {}));
          });
        } else {
          const data = obj.data;
          const groupName = String(obj.name || obj.title || obj.key || obj.aspectName || (data && data.title) || '').trim();
          const values =
            obj.aspectValues ||
            obj.variants ||
            obj.options ||
            obj.values ||
            obj.items ||
            obj.buttons ||
            obj.pills ||
            obj.rs ||
            obj.cs;
          if (isSpecAspectName(groupName) && groupName && Array.isArray(values) && values.length >= 2) {
            values.forEach((item) => rememberVariant(groupName, item || {}));
          }
        }
        const charRows = []
          .concat(obj.characteristics || [])
          .concat(obj.shortCharacteristics || [])
          .concat(obj.characteristicsList || [])
          .concat(obj.fullCharacteristics || [])
          .concat(obj.descriptionCharacteristics || [])
          .concat(obj.productCharacteristics || [])
          .concat(obj.attrs || []);
        charRows.forEach((row) => {
          const title = row && (row.title || row.name || row.key);
          const values = row && (row.values !== undefined ? row.values : row.value);
          let text = '';
          if (typeof values === 'string' || typeof values === 'number') text = String(values);
          else if (Array.isArray(values)) {
            text = values
              .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item) : (item && (item.text || item.value || item.title)) || ''))
              .filter(Boolean)
              .join(', ');
          }
          addSpec(specs, title, text);
        });
        if (!obj.src && !obj.original && obj.depth != null && obj.width != null && obj.height != null) {
          const depth = Number(obj.depth);
          const width = Number(obj.width);
          const height = Number(obj.height);
          const weight = Number(obj.weight);
          if ([depth, width, height].every((item) => isFinite(item) && item > 0 && item < 5000)) {
            addSpec(specs, 'Длина, мм', String(Math.round(depth)));
            addSpec(specs, 'Ширина, мм', String(Math.round(width)));
            addSpec(specs, 'Высота, мм', String(Math.round(height)));
            if (isFinite(weight) && weight > 0 && weight < 100000) addSpec(specs, 'Вес товара, г', String(Math.round(weight)));
          }
        }
        if (
          obj.cardPrice ||
          obj.originalPrice ||
          obj.marketingPrice ||
          obj.discountPrice ||
          (typeof obj.price === 'string' && String(obj.price).length < 24)
        ) {
          const card = parsePrice(obj.cardPrice || obj.finalPrice);
          const listed = parsePrice(obj.price);
          const marketing = parsePrice(obj.marketingPrice || obj.discountPrice);
          const original = parsePrice(obj.originalPrice || obj.oldPrice || obj.priceWithoutDiscount);
          const sale = card || listed;
          const discount = marketing || (card && listed && listed !== card ? listed : 0) || sale;
          if (sale > treePrice) treePrice = sale;
          if (discount > discountPrice) discountPrice = discount;
          if (original > originalPrice) originalPrice = original;
        }
        if (typeof obj.description === 'string' && obj.description.replace(/<[^>]+>/g, ' ').trim().length > description.length) {
          description = obj.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (typeof obj.brand === 'string' && obj.brand.trim()) brand = obj.brand.trim();
        if (obj.brand && typeof obj.brand.name === 'string') brand = obj.brand.name.trim();
      },
      0,
    );
  });

  document.querySelectorAll('[data-widget="webGallery"] img, [data-widget="webGallery"] source').forEach((img) => {
    urls.push(img.currentSrc || img.src || img.getAttribute('srcset'));
    if (img.srcset) img.srcset.split(',').forEach((part) => urls.push(part.trim().split(' ')[0]));
    urls.push(img.getAttribute('data-src'));
  });
  const og = document.querySelector('meta[property="og:image"]');
  if (og) urls.push(og.content);
  if (jsonLd.image) {
    const images = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
    images.forEach((item) => urls.push(typeof item === 'string' ? item : item && item.url));
  }

  function aspectHeading(el, root) {
    let node = el.parentElement;
    for (let i = 0; i < 8 && node && node !== root; i += 1) {
      const prev = node.previousElementSibling;
      const t = prev ? (prev.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const label = t.split(':')[0].trim();
      if (label && label.length < 48 && isSpecAspectName(label)) return label;
      node = node.parentElement;
    }
    return '';
  }
  const aspectRoot = document.querySelector('[data-widget="webAspects"], [data-widget="aspectsCompact"]');
  if (aspectRoot) {
    aspectRoot.querySelectorAll('a[href*="/product/"], button, [role="radio"], [role="option"], [role="button"], [data-sku], [data-sku-id]').forEach((el) => {
      const img = el.querySelector && el.querySelector('img');
      const raw =
        (el.textContent || '').replace(/\s+/g, ' ').trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (img && (img.getAttribute('alt') || img.getAttribute('title'))) ||
        '';
      if ((!raw || raw.length > 160) && !img) return;
      const link =
        el.getAttribute('href') ||
        (el.closest && el.closest('a') && el.closest('a').getAttribute('href')) ||
        '';
      const skuAttr = el.getAttribute('data-sku') || el.getAttribute('data-sku-id') || '';
      const group = aspectHeading(el, aspectRoot);
      if (!group || !isSpecAspectName(group)) return;
      rememberVariant(group, {
        value: raw,
        link,
        ariaLabel: el.getAttribute('aria-label') || (img && img.getAttribute('alt')),
        image: img && (img.currentSrc || img.src),
        selected:
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('aria-checked') === 'true' ||
          el.getAttribute('aria-current') === 'true',
        sku: skuAttr || (el.getAttribute('aria-pressed') === 'true' ? String(sku || '') : undefined),
      });
    });
    const family = listingSlugFamily(location.href);
    const linkRe = /\/product\/([a-z0-9\-._%]{3,220})-(\d{6,})/gi;
    let linkMatch;
    const rootHtml = aspectRoot.innerHTML || '';
    while ((linkMatch = linkRe.exec(rootHtml))) {
      const skuId = linkMatch[2];
      const sourceUrl = 'https://www.ozon.ru/product/' + linkMatch[1] + '-' + skuId + '/';
      if (family.split('-').length >= 2 && listingSlugFamily(sourceUrl) !== family) continue;
      const weight = inferWeightFrom(linkMatch[1].replace(/-/g, ' '), sourceUrl);
      if (weight && /-\d+-g|-1-kg|-\d+-kg/i.test(linkMatch[1])) {
        rememberVariant('Вес товара, г', { value: weight, link: sourceUrl, sku: skuId });
      }
    }
  }

  (jsonLd.additionalProperty
    ? Array.isArray(jsonLd.additionalProperty)
      ? jsonLd.additionalProperty
      : [jsonLd.additionalProperty]
    : []
  ).forEach((item) => addSpec(specs, item && item.name, item && item.value));
  document
    .querySelectorAll('[data-widget="webCharacteristics"] dt, [data-widget="webShortCharacteristics"] dt')
    .forEach((dt) => addSpec(specs, dt.textContent, dt.nextElementSibling && dt.nextElementSibling.textContent));
  document
    .querySelectorAll('[data-widget="webCharacteristics"] tr, [data-widget="webShortCharacteristics"] tr')
    .forEach((tr) => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length >= 2) addSpec(specs, cells[0].textContent, cells[1].textContent);
    });

  const descNode = document.querySelector(
    '[data-widget="webDescription"], [data-widget="webProductDescription"], [itemprop="description"]',
  );
  if (descNode && descNode.innerText && descNode.innerText.trim().length > description.length) {
    description = descNode.innerText.replace(/\s+/g, ' ').trim().slice(0, 8000);
  }
  const hasDimSpec = specs.some((item) =>
    /длина|ширина|высота|глубина|габарит|вес товара|вес брутто|вес с упаков|length|width|height|weight/i.test(item.name),
  );
  if (!hasDimSpec) {
    const sizeMatch = [name, description]
      .filter(Boolean)
      .join(' ')
      .match(/(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх×*]\s*(\d+(?:[.,]\d+)?))?\s*(мм|mm|см|cm)/i);
    if (sizeMatch) addSpec(specs, 'Габариты', sizeMatch[0].replace(/\s+/g, ' ').trim());
  }
  if (description) addSpec(specs, '商品描述', description.slice(0, 4000));

  const crumbs = [];
  document.querySelectorAll('[data-widget="breadCrumbs"] a, nav[aria-label] a').forEach((a) => {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) crumbs.push(text);
  });

  const offers = jsonLd.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const priceNode = document.querySelector('[data-widget="webPrice"], [data-widget="webSale"]');
  const price = parsePrice((offer && offer.price) || treePrice || (priceNode && priceNode.textContent)) || treePrice;
  const imageUrls = uniqueImages(urls);
  const trimmedName = String(name || '').trim();
  const variants = Object.keys(variantsMap)
    .map((key) => variantsMap[key])
    .filter((item) => isSpecAspectName(item.name) && item.values.length >= 2)
    .map((item) => {
      const current =
        item.values.find((value) => value.skuId && value.skuId === String(sku)) ||
        item.values.find((value) => value.selected) ||
        item.values.find((value) => trimmedName.includes(value.value));
      return {
        ...item,
        values: item.values.map((value) => ({
          ...value,
          selected: Boolean(current && value.value === current.value),
        })),
      };
    });
  const ratingRaw = jsonLd.aggregateRating && jsonLd.aggregateRating.ratingValue;
  const rating = ratingRaw ? Number(String(ratingRaw).replace(',', '.')) : undefined;
  const reviewCount = parsePrice(jsonLd.aggregateRating && (jsonLd.aggregateRating.reviewCount || jsonLd.aggregateRating.ratingCount));
  const usable = Boolean(sku && trimmedName && !/^ozon\.?$/i.test(trimmedName));
  if (!usable && isChallengePage()) return { blocked: true };

  return {
    skuId: String(sku || ''),
    name: trimmedName,
    sourceUrl: location.href,
    mainImageUrl: imageUrls[0],
    imageUrls,
    videoUrls: videos.filter((item, i, arr) => item && arr.indexOf(item) === i).slice(0, 8),
    price,
    originalPrice: originalPrice > price ? originalPrice : undefined,
    discountPrice: discountPrice || (originalPrice > price ? price : undefined),
    currency: (offer && offer.priceCurrency) || 'RUB',
    stock: price > 0 ? 1 : 0,
    specs,
    variants,
    categoryPath: crumbs.length ? crumbs.join(' / ') : undefined,
    brand: brand || (specs.find((item) => /бренд|brand|торговая марка/i.test(item.name)) || {}).value,
    description: description || undefined,
    rating: isFinite(rating) ? rating : undefined,
    reviewCount: reviewCount || undefined,
    salesCount: reviewCount || 0,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT') {
    sendResponse(isListingLocation() ? extractListing(message.limit || 80) : extract());
  }
  return true;
});
