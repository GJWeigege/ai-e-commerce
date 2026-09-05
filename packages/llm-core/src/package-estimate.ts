import {
  inspectPackageDimensions,
  PackageDimensionGaps,
  PackageDimensions,
  WB_MAX_PACKAGE_EDGE_CM,
} from '@aiecom/shared';

export const PACKAGE_ESTIMATE_PROMPT_VERSION = 'v3';

export const AI_PACKAGE_SPEC = {
  length: 'Длина упаковки, см',
  width: 'Ширина упаковки, см',
  height: 'Высота упаковки, см',
  weight: 'Вес брутто, кг',
  source: 'AI包裹预估来源',
  reason: 'AI包裹预估说明',
} as const;

const AI_PACKAGE_SPEC_NAMES = new Set<string>(Object.values(AI_PACKAGE_SPEC));

export type PackageEstimateProduct = {
  skuId?: string;
  name: string;
  categoryPath?: string | null;
  brand?: string | null;
  description?: string | null;
  specs?: Array<{ name: string; value: string }> | null;
  skuOptions?: Array<{ name?: string; options?: Record<string, string> }> | null;
};

export type PackageEstimateOutput = {
  length?: number;
  width?: number;
  height?: number;
  weightBrutto?: number;
  confidence: number;
  categoryHint: string;
  reason: string;
  assumptions: string[];
};

export function isAiPackageSpecName(name: string): boolean {
  return AI_PACKAGE_SPEC_NAMES.has(String(name || '').trim());
}

export function stripAiPackageSpecs(specs: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return specs.filter((item) => !isAiPackageSpecName(item.name));
}

export function parseJsonFromAgentText(text: string): unknown {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Cursor Agent 未返回内容');
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] || trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Cursor Agent 未返回 JSON 对象');
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('Cursor Agent 返回的 JSON 无法解析');
  }
}

function clampEdgeCm(raw: unknown): number | undefined {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  const rounded = Math.max(1, Math.ceil(num));
  return rounded > WB_MAX_PACKAGE_EDGE_CM ? undefined : rounded;
}

function clampWeightKg(raw: unknown): number | undefined {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  const kg = Math.ceil(num * 1000) / 1000;
  if (kg < 0.01 || kg > 40) {
    return undefined;
  }
  return kg;
}

export function parsePackageEstimateOutput(raw: unknown): PackageEstimateOutput {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const length = clampEdgeCm(data.lengthCm ?? data.length);
  const width = clampEdgeCm(data.widthCm ?? data.width);
  const height = clampEdgeCm(data.heightCm ?? data.height);
  const weightBrutto = clampWeightKg(data.weightKg ?? data.weightBrutto ?? data.weight);
  const confidenceRaw = Number(data.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0.5;
  return {
    ...(length ? { length } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(weightBrutto ? { weightBrutto } : {}),
    confidence,
    categoryHint: String(data.categoryHint ?? '').trim(),
    reason: String(data.reason ?? '').trim(),
    assumptions: Array.isArray(data.assumptions) ? data.assumptions.map(String).filter(Boolean) : [],
  };
}

export function inspectEstimateProduct(product: PackageEstimateProduct): PackageDimensionGaps {
  return inspectPackageDimensions(product.specs ?? [], {
    name: product.name,
    description: product.description,
    skuOptions: product.skuOptions ?? [],
  });
}

export type PackMethod = 'fold' | 'roll' | 'mailer' | 'retail_box' | 'bottle_box' | 'shoe_box' | 'flat_pack' | 'carton';

export type PackProfile = {
  id: string;
  label: string;
  method: PackMethod;
  /** 超过该边长多半是使用/展开尺寸，必须换成包裹外廓 */
  useSizeAlertCm: number;
  packed: { length: [number, number]; width: [number, number]; height: [number, number] };
  typical: { length: number; width: number; height: number };
  promptRule: string;
  match: RegExp;
};

function range(min: number, max: number): [number, number] {
  return [min, max];
}

/** 按品类的仓配打包方式；先匹配先命中 */
export const PACK_PROFILES: PackProfile[] = [
  {
    id: 'textile_fold',
    label: '纺织/服装折叠袋',
    method: 'fold',
    useSizeAlertCm: 55,
    packed: { length: range(22, 40), width: range(16, 30), height: range(4, 14) },
    typical: { length: 32, width: 24, height: 8 },
    promptRule: '毛巾、床单、T恤、窗帘等先折叠进快递袋。展开 170cm 的毛巾包裹约 32×24×8，不是 170。',
    match:
      /towel|полотенц|простын|пододеял|наволоч|покрывал|плед|халат|штор|скатерт|одежд|футболк|плать|рубашк|брюк|штаны|носк|белье|ткан|постел|curtain|bedding|sheet|blanket|robe|apparel|textile|одежда|текстиль/i,
  },
  {
    id: 'phone_gadget',
    label: '数码配件袋/盒',
    method: 'mailer',
    useSizeAlertCm: 25,
    packed: { length: range(12, 28), width: range(8, 20), height: range(2, 10) },
    typical: { length: 18, width: 12, height: 4 },
    promptRule: '手机壳、贴膜、充电头、U盘用小袋或小盒，约 18×12×4。',
    match: /чехол|пленк|зарядк|кабель usb|usb.?cabl|наушник|flash|powerbank|phone case|смартфон.?чехол|гаджет/i,
  },
  {
    id: 'roll',
    label: '卷装',
    method: 'roll',
    useSizeAlertCm: 50,
    packed: { length: range(18, 70), width: range(8, 22), height: range(8, 22) },
    typical: { length: 35, width: 14, height: 14 },
    promptRule: '瑜伽垫、海报、壁纸、线材、软管、灯带按卷筒装箱，不要用展开长度。5m 灯带约 18×18×6。',
    match: /коврик|yoga|мат(?![еа])|постер|обои|кабель|провод|шнур|лента|шланг|hose|led.?strip|катушк|рулон/i,
  },
  {
    id: 'shoes',
    label: '鞋盒',
    method: 'shoe_box',
    useSizeAlertCm: 45,
    packed: { length: range(28, 40), width: range(18, 28), height: range(10, 16) },
    typical: { length: 34, width: 22, height: 12 },
    promptRule: '鞋类用鞋盒外廓，约 34×22×12，不是脚长。',
    match: /обув|кроссовк|ботинк|туфл|сандал|тапоч|shoe|sneaker|boot|кроссовки/i,
  },
  {
    id: 'beauty_bottle',
    label: '瓶/管装箱',
    method: 'bottle_box',
    useSizeAlertCm: 28,
    packed: { length: range(10, 24), width: range(7, 16), height: range(8, 28) },
    typical: { length: 16, width: 10, height: 18 },
    promptRule: '化妆品、洗涤、油液、果酱用瓶罐外盒+缓冲，约 16×10×18，不要用瓶身高度当三边。',
    match:
      /космет|шампун|крем|лосьон|парфюм|мыло|гель|масл|бутылк|флакон|банк[аи]|cosmetic|shampoo|serum|perfume|моющее|бытов(?:ая)? хими/i,
  },
  {
    id: 'cookware',
    label: '厨具彩盒',
    method: 'retail_box',
    useSizeAlertCm: 40,
    packed: { length: range(22, 42), width: range(18, 38), height: range(6, 18) },
    typical: { length: 32, width: 32, height: 10 },
    promptRule: '锅、平底锅按彩盒，直径 28cm 的锅约 32×32×10，不是 28×28×28。',
    match: /кастрюл|сковород|сотейник|чайник|ковш|pan|pot|cookware|посуд|нож(?![к])/i,
  },
  {
    id: 'electronics_box',
    label: '电子零售盒',
    method: 'retail_box',
    useSizeAlertCm: 55,
    packed: { length: range(14, 55), width: range(10, 40), height: range(4, 18) },
    typical: { length: 22, width: 16, height: 8 },
    promptRule: '耳机、键鼠、小家电用原厂彩盒每边 +2cm，不要用屏幕对角线或天线长度。',
    match: /клавиатур|мышк|планшет|роутер|камер|бритв|фен|утюг|electron|техника/i,
  },
  {
    id: 'display',
    label: '屏/大家电原箱',
    method: 'carton',
    useSizeAlertCm: 90,
    packed: { length: range(40, 140), width: range(8, 80), height: range(8, 70) },
    typical: { length: 110, width: 70, height: 16 },
    promptRule: '电视/显示器按纸箱，不是英寸对角线。55 寸约 110×70×16。',
    match: /телевизор|монитор|tv\b|display|холодиль|стиральн|микроволн/i,
  },
  {
    id: 'furniture_kd',
    label: '家具扁平箱',
    method: 'flat_pack',
    useSizeAlertCm: 80,
    packed: { length: range(50, 140), width: range(30, 80), height: range(8, 30) },
    typical: { length: 90, width: 45, height: 16 },
    promptRule: '桌椅柜拆装扁平纸箱，沙发展开 200cm 不是包裹边，常见 90×45×16。床垫除外可接近展开。',
    match: /мебел|диван|шкаф|стол|стул|полк|комод|furniture|стеллаж/i,
  },
  {
    id: 'mattress',
    label: '床垫压缩卷',
    method: 'roll',
    useSizeAlertCm: 120,
    packed: { length: range(80, 200), width: range(30, 50), height: range(30, 50) },
    typical: { length: 120, width: 40, height: 40 },
    promptRule: '床垫多为压缩卷，约 120×40×40，不是床面 200×160。',
    match: /матрас|mattress/i,
  },
  {
    id: 'toy_box',
    label: '玩具彩盒',
    method: 'retail_box',
    useSizeAlertCm: 50,
    packed: { length: range(16, 45), width: range(12, 35), height: range(6, 25) },
    typical: { length: 28, width: 20, height: 12 },
    promptRule: '玩具用彩盒，不要按拼装后身高。',
    match: /игрушк|конструктор|кукл|lego|toy/i,
  },
  {
    id: 'sport',
    label: '运动器材装箱',
    method: 'carton',
    useSizeAlertCm: 70,
    packed: { length: range(20, 90), width: range(12, 40), height: range(8, 30) },
    typical: { length: 40, width: 20, height: 14 },
    promptRule: '球类放气装箱，球拍套袋，不要用球场或球拍挥击长度。',
    match: /спорт|мяч|ракетк|гантел|скакалк|sport|dumbbell|bicycle|велосипед/i,
  },
  {
    id: 'auto_part',
    label: '汽配纸箱',
    method: 'carton',
    useSizeAlertCm: 60,
    packed: { length: range(18, 55), width: range(12, 40), height: range(6, 25) },
    typical: { length: 32, width: 22, height: 12 },
    promptRule: '汽配按配件盒，雨刷展开长度要折盒。',
    match: /авто|масл.?фильтр|колодк|дворник|auto.?part|запчаст/i,
  },
  {
    id: 'food',
    label: '食品袋/箱',
    method: 'mailer',
    useSizeAlertCm: 35,
    packed: { length: range(14, 36), width: range(10, 26), height: range(4, 18) },
    typical: { length: 22, width: 16, height: 8 },
    promptRule: '咖啡、零食、茶叶按袋或小箱，1kg 咖啡约 22×16×8。',
    match: /кофе|чай|снек|круп|сахар|food|бакалея|продукт.?питан|шоколад/i,
  },
  {
    id: 'books',
    label: '图书袋',
    method: 'mailer',
    useSizeAlertCm: 35,
    packed: { length: range(18, 34), width: range(12, 26), height: range(2, 12) },
    typical: { length: 24, width: 18, height: 4 },
    promptRule: '书刊按袋装叠放，不是展开书页。',
    match: /книг|журнал|book|канцтовар|тетрад/i,
  },
  {
    id: 'jewelry',
    label: '饰品小盒',
    method: 'mailer',
    useSizeAlertCm: 18,
    packed: { length: range(8, 18), width: range(6, 14), height: range(2, 6) },
    typical: { length: 12, width: 10, height: 4 },
    promptRule: '饰品小盒约 12×10×4。',
    match: /украшен|кольц|серьг|браслет|цепочк|jewelry|бижутер/i,
  },
];

export const DEFAULT_PACK_PROFILE: PackProfile = {
  id: 'generic_parcel',
  label: '通用电商包裹',
  method: 'carton',
  useSizeAlertCm: 50,
  packed: { length: range(16, 45), width: range(12, 32), height: range(4, 22) },
  typical: { length: 30, width: 22, height: 12 },
  promptRule: '无法识别时估快递袋/纸箱外廓，每边可加 2cm 缓冲，禁止把使用尺寸、展开长度、直径直接当三边。',
  match: /.^/,
};

function productPackBlob(product: PackageEstimateProduct): string {
  return [
    product.name,
    product.categoryPath,
    product.description,
    ...(product.specs ?? []).flatMap((item) => [item.name, item.value]),
  ]
    .filter(Boolean)
    .join(' ');
}

export function resolvePackProfile(product: PackageEstimateProduct): PackProfile {
  const blob = productPackBlob(product);
  return PACK_PROFILES.find((item) => item.match.test(blob)) ?? DEFAULT_PACK_PROFILE;
}

export function isFoldablePackProduct(product: PackageEstimateProduct): boolean {
  return resolvePackProfile(product).method === 'fold';
}

function clampPacked(value: number, span: [number, number]): number {
  return Math.min(span[1], Math.max(span[0], Math.max(1, Math.ceil(value))));
}

function looksLikeUseSize(profile: PackProfile, edges: number[]): boolean {
  const longest = edges[0] || 0;
  const shortest = edges[2] || 0;
  if (longest >= profile.useSizeAlertCm) {
    return true;
  }
  if (longest > profile.packed.length[1] * 1.25 && profile.method !== 'carton' && profile.method !== 'flat_pack') {
    return true;
  }
  // 锅径立方体、瓶高当三边：最短边已超过该品类包裹高度上限
  return shortest > profile.packed.height[1] && longest <= profile.packed.length[1] * 1.15;
}

function cuboidFromProfile(
  profile: PackProfile,
  edges: number[],
  weightKg: number,
): { length: number; width: number; height: number } {
  const longest = edges[0] || profile.typical.length;
  const mid = edges[1] || profile.typical.width;
  const shortest = edges[2] || profile.typical.height;
  switch (profile.method) {
    case 'fold':
      return {
        length: clampPacked(longest / 6, profile.packed.length),
        width: clampPacked(mid / 4, profile.packed.width),
        height: clampPacked(3 + weightKg * 6, profile.packed.height),
      };
    case 'roll':
      return {
        length: clampPacked(Math.min(longest, 90) * 0.35, profile.packed.length),
        width: clampPacked(10 + weightKg * 5, profile.packed.width),
        height: clampPacked(10 + weightKg * 5, profile.packed.height),
      };
    case 'shoe_box':
      return { ...profile.typical };
    case 'bottle_box':
      return {
        length: clampPacked(profile.typical.length, profile.packed.length),
        width: clampPacked(profile.typical.width, profile.packed.width),
        height: clampPacked(Math.min(longest + 2, profile.typical.height + 4), profile.packed.height),
      };
    case 'flat_pack':
      return {
        length: clampPacked(Math.min(longest * 0.55, 120), profile.packed.length),
        width: clampPacked(mid * 0.5, profile.packed.width),
        height: clampPacked(8 + weightKg, profile.packed.height),
      };
    case 'mailer':
      return {
        length: clampPacked(Math.min(longest, profile.typical.length + 4), profile.packed.length),
        width: clampPacked(Math.min(mid, profile.typical.width + 4), profile.packed.width),
        height: clampPacked(Math.min(shortest + 2, profile.typical.height + 2), profile.packed.height),
      };
    case 'retail_box':
    case 'carton':
    default:
      return {
        length: clampPacked(Math.min(longest + 2, profile.typical.length + 8), profile.packed.length),
        width: clampPacked(Math.min(mid + 2, profile.typical.width + 6), profile.packed.width),
        height: clampPacked(Math.min(shortest + 2, profile.typical.height + 4), profile.packed.height),
      };
  }
}

/** 任意品类：若模型给出使用/展开尺寸，压成该品类真实发货包裹 */
export function refinePackedEstimate(
  product: PackageEstimateProduct,
  estimate: PackageEstimateOutput,
): PackageEstimateOutput {
  if (!estimate.length || !estimate.width || !estimate.height) {
    return estimate;
  }
  const profile = resolvePackProfile(product);
  const edges = [estimate.length, estimate.width, estimate.height].sort((a, b) => b - a);
  if (!looksLikeUseSize(profile, edges)) {
    return {
      ...estimate,
      categoryHint: estimate.categoryHint || profile.label,
    };
  }
  const packed = cuboidFromProfile(profile, edges, estimate.weightBrutto || 0.4);
  return {
    ...estimate,
    ...packed,
    categoryHint: estimate.categoryHint || profile.label,
    reason: [estimate.reason, `已按「${profile.label}」估算发货包裹，不是商品使用/展开尺寸`]
      .filter(Boolean)
      .join('；')
      .slice(0, 300),
    assumptions: [
      ...estimate.assumptions,
      `识别打包方式 ${profile.method}；模型边约 ${edges.join('×')}cm → 包裹 ${packed.length}×${packed.width}×${packed.height}cm`,
    ],
  };
}

export function buildPackageEstimatePrompt(product: PackageEstimateProduct, gaps: PackageDimensionGaps): string {
  const profile = resolvePackProfile(product);
  const need = [
    gaps.missingSize ? '发货包裹长宽高(cm)' : null,
    gaps.missingWeight ? '发货包裹毛重(kg)' : null,
  ].filter(Boolean);
  return [
    '你是俄罗斯跨境电商仓配专家，为 Wildberries 官方仓中转预估【已打包可交运的包裹】。',
    '只输出一个 JSON 对象，不要 markdown，不要解释，不要读写文件或执行命令。',
    '单位：lengthCm/widthCm/heightCm 为厘米整数；weightKg 为千克，最多三位小数。',
    '输出必须是快递员手里的包裹外廓和毛重，禁止商品平铺、展开、使用尺寸、屏幕对角线、锅径、床面、天线/软管长度。',
    '先判断品类打包方式，再估包裹：折叠袋、卷筒、鞋盒、瓶罐彩盒、零售彩盒、扁平家具箱、原厂纸箱、气泡袋。',
    '本单识别：' + `${profile.label}（${profile.method}）。${profile.promptRule}`,
    '其他品类同样按仓储习惯：灯具拆杆装箱、雨伞折短、珠宝小盒、图书袋装、食品袋装、汽配纸箱。',
    '标题/规格里的 длина、размер、диаметр 多半是成品口径，不能直接当包裹三边。',
    `该品类包裹边长建议 ${profile.packed.length[0]}–${profile.packed.length[1]} × ${profile.packed.width[0]}–${profile.packed.width[1]} × ${profile.packed.height[0]}–${profile.packed.height[1]} cm，参考 ${profile.typical.length}×${profile.typical.width}×${profile.typical.height}。大家具/床垫/大家电可更大，上限 700cm。`,
    '毛重含包装材料，0.05–30kg；标题有克重则换算后再加包材。',
    `本单需要补齐：${need.join('、') || '包裹尺寸与重量'}。已采集到的字段沿用，缺口按包裹口径估计。`,
    '字段：lengthCm, widthCm, heightCm, weightKg, confidence(0~1), categoryHint, reason(中文简述该品类如何装箱), assumptions(string[])。',
    JSON.stringify({
      skuId: product.skuId,
      name: product.name,
      categoryPath: product.categoryPath,
      brand: product.brand,
      description: product.description ? String(product.description).slice(0, 800) : undefined,
      specs: (product.specs ?? []).slice(0, 40),
      skuOptions: (product.skuOptions ?? []).slice(0, 8).map((item) => ({
        name: item.name,
        options: item.options,
      })),
      collected: gaps.dimensions,
      missingSize: gaps.missingSize,
      missingWeight: gaps.missingWeight,
      packProfile: {
        id: profile.id,
        label: profile.label,
        method: profile.method,
        typicalCm: profile.typical,
      },
    }),
  ].join('\n');
}

export function mergeEstimatedPackageSpecs(
  specs: Array<{ name: string; value: string }>,
  estimate: PackageEstimateOutput,
  gaps: PackageDimensionGaps,
  meta: { source: string; model: string },
): Array<{ name: string; value: string }> {
  const next = stripAiPackageSpecs(specs);
  const writeSize = gaps.missingSize && Boolean(estimate.length && estimate.width && estimate.height);
  const writeWeight = gaps.missingWeight && Boolean(estimate.weightBrutto);
  if (writeSize && estimate.length && estimate.width && estimate.height) {
    next.push(
      { name: AI_PACKAGE_SPEC.length, value: String(estimate.length) },
      { name: AI_PACKAGE_SPEC.width, value: String(estimate.width) },
      { name: AI_PACKAGE_SPEC.height, value: String(estimate.height) },
    );
  }
  if (writeWeight && estimate.weightBrutto) {
    next.push({ name: AI_PACKAGE_SPEC.weight, value: String(estimate.weightBrutto) });
  }
  if (writeSize || writeWeight) {
    next.push({
      name: AI_PACKAGE_SPEC.source,
      value: `${meta.source}/${meta.model}`,
    });
    const reason = [estimate.categoryHint, estimate.reason].filter(Boolean).join(' · ').slice(0, 300);
    if (reason) {
      next.push({ name: AI_PACKAGE_SPEC.reason, value: reason });
    }
  }
  return next;
}

export function estimatedDimensionsFromOutput(estimate: PackageEstimateOutput): PackageDimensions {
  return {
    ...(estimate.length ? { length: estimate.length } : {}),
    ...(estimate.width ? { width: estimate.width } : {}),
    ...(estimate.height ? { height: estimate.height } : {}),
    ...(estimate.weightBrutto ? { weightBrutto: estimate.weightBrutto } : {}),
  };
}
