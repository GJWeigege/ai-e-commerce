import { OzonFulfillment } from '@aiecom/shared';

export type OzonAvailability = {
  stock: number;
  fboStock?: number;
  fbsStock?: number;
  warehouseType?: OzonFulfillment;
};

const STOCK_KEYS = [
  'availableStock',
  'availableCount',
  'availableAmount',
  'stockCount',
  'freeStock',
  'leftover',
  'remains',
  'remain',
  'qty',
  'quantity',
  'stock',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asPositiveInt(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\s+/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
    return undefined;
  }
  return Math.round(n);
}

function blobOf(obj: Record<string, unknown>): string {
  return [
    obj.deliverySchema,
    obj.availabilityType,
    obj.warehouseType,
    obj.fulfillmentType,
    obj.deliveryType,
    obj.salesSchema,
    obj.schema,
    obj.deliveryFrom,
    obj.from,
    obj.title,
    obj.text,
    obj.name,
  ]
    .map((item) => String(item || ''))
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function flagsFromBlob(blob: string): { fbo: boolean; fbs: boolean } {
  const fbo =
    /\bfbo\b/.test(blob) ||
    /склад\s+ozon|со склада ozon|ozon склад|fulfillment by ozon|доставка со склада ozon/.test(blob);
  const fbs =
    /\bfbs\b/.test(blob) ||
    /склад\s+продавц|со склада продавц|fulfillment by seller/.test(blob);
  return { fbo, fbs };
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 16 || node == null) {
    return;
  }
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 8) {
      try {
        walk(JSON.parse(trimmed) as unknown, visit, depth + 1);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit, depth + 1));
    return;
  }
  const rec = asRecord(node);
  if (!rec) {
    return;
  }
  visit(rec);
  for (const [key, value] of Object.entries(rec)) {
    if (/recommend|похож|хиты|карусел|looked|similar/i.test(key)) {
      continue;
    }
    walk(value, visit, depth + 1);
  }
}

function namedStock(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (obj[key] == null) {
      continue;
    }
    const value = asPositiveInt(obj[key]);
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

/** 从 Ozon widget / composer JSON 里抽出总库存和 FBO/FBS 分仓库存 */
export function collectOzonAvailability(trees: unknown[], fallbackStock = 0): OzonAvailability {
  let fboStock = 0;
  let fbsStock = 0;
  let totalStock = 0;
  let sawFbo = false;
  let sawFbs = false;

  for (const tree of trees) {
    walk(tree, (obj) => {
      const blob = blobOf(obj);
      const flags = flagsFromBlob(blob);
      const fboNamed = namedStock(obj, [
        'fboStock',
        'stockFbo',
        'fboCount',
        'fboQty',
        'availableFbo',
        'fboAvailable',
      ]);
      const fbsNamed = namedStock(obj, [
        'fbsStock',
        'stockFbs',
        'fbsCount',
        'fbsQty',
        'availableFbs',
        'fbsAvailable',
      ]);
      const generic = namedStock(obj, STOCK_KEYS);
      if (fboNamed != null) {
        fboStock = Math.max(fboStock, fboNamed);
        sawFbo = true;
      }
      if (fbsNamed != null) {
        fbsStock = Math.max(fbsStock, fbsNamed);
        sawFbs = true;
      }
      if (generic != null) {
        if (flags.fbo && !flags.fbs) {
          fboStock = Math.max(fboStock, generic);
          sawFbo = true;
        } else if (flags.fbs && !flags.fbo) {
          fbsStock = Math.max(fbsStock, generic);
          sawFbs = true;
        } else {
          totalStock = Math.max(totalStock, generic);
        }
      } else if (flags.fbo) {
        sawFbo = true;
      } else if (flags.fbs) {
        sawFbs = true;
      }
    });
  }

  const stock = Math.max(totalStock, fboStock, fbsStock, fallbackStock);
  const warehouseType: OzonFulfillment | undefined =
    sawFbo && sawFbs ? 'MIXED' : sawFbo ? 'FBO' : sawFbs ? 'FBS' : undefined;
  return {
    stock,
    ...(fboStock > 0 || sawFbo ? { fboStock } : {}),
    ...(fbsStock > 0 || sawFbs ? { fbsStock } : {}),
    ...(warehouseType ? { warehouseType } : {}),
  };
}

export function resolveWarehouseType(product: {
  warehouseType?: string | null;
  fboStock?: number | null;
  fbsStock?: number | null;
}): OzonFulfillment | null {
  const typed = String(product.warehouseType || '').toUpperCase();
  if (typed === 'FBO' || typed === 'FBS' || typed === 'MIXED') {
    return typed;
  }
  const fbo = Number(product.fboStock) || 0;
  const fbs = Number(product.fbsStock) || 0;
  if (fbo > 0 && fbs > 0) {
    return 'MIXED';
  }
  if (fbo > 0) {
    return 'FBO';
  }
  if (fbs > 0) {
    return 'FBS';
  }
  return null;
}
