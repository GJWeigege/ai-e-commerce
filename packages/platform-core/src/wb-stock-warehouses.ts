export type WbSellerWarehouse = {
  id: number;
  name: string;
  cargoType?: number;
  deliveryType?: number;
};

/** 1 小件 МГТ；2 超规 СГТ / ODC；3 大件 КГТ+ / CD+ */
export const WB_CARGO_MGT = 1;
export const WB_CARGO_SGT = 2;
export const WB_CARGO_KGT_PLUS = 3;

const ODC_CARGO_TYPES = new Set([WB_CARGO_SGT, WB_CARGO_KGT_PLUS]);
const MGT_MAX_KG = 25;
const MGT_MAX_SIDE_CM = 120;
const MGT_MAX_SUM_CM = 200;

export function inferWbCargoType(dims?: {
  length?: number;
  width?: number;
  height?: number;
  weightBrutto?: number;
} | null): number | undefined {
  if (!dims) {
    return undefined;
  }
  const sides = [dims.length, dims.width, dims.height].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  const weight = typeof dims.weightBrutto === 'number' && dims.weightBrutto > 0 ? dims.weightBrutto : 0;
  if (!sides.length && !weight) {
    return undefined;
  }
  const longest = sides.length ? Math.max(...sides) : 0;
  const sum = sides.reduce((total, side) => total + side, 0);
  const exceedsMgt = weight > MGT_MAX_KG || longest > MGT_MAX_SIDE_CM || (sides.length === 3 && sum > MGT_MAX_SUM_CM);
  if (!exceedsMgt) {
    return WB_CARGO_MGT;
  }
  if (weight > 100 || longest > 200) {
    return WB_CARGO_KGT_PLUS;
  }
  return WB_CARGO_SGT;
}

export function cargoTypesFromStockError(message: string): number[] | null {
  if (/CargoWarehouseRestrictionSGTKGTPlus|ODC\/CD\+|label - ODC|метк[аи].*ODC|СГТ|КГТ\+/i.test(message)) {
    return [WB_CARGO_SGT, WB_CARGO_KGT_PLUS];
  }
  if (/CargoWarehouseRestrictionMGT|type "MGT"|малогабарит|МГТ/i.test(message)) {
    return [WB_CARGO_MGT];
  }
  return null;
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function readWarehousesByCargoType(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = positiveInt(raw);
    if (id) {
      result[key] = id;
    }
  }
  return result;
}

/** 环境变量 / extra.warehouseId 是运营指定仓；按货型记住的仓只作回退，避免泉州仓之类自动覆盖 */
export function resolveWbPreferredWarehouseId(options: {
  extraWarehouseId?: unknown;
  warehousesByCargoType?: Record<string, number>;
  envWarehouseId?: unknown;
  cargoType?: number;
}): number | undefined {
  const configured = positiveInt(options.envWarehouseId) ?? positiveInt(options.extraWarehouseId);
  if (configured) {
    return configured;
  }
  const byType = options.warehousesByCargoType || {};
  if (options.cargoType === 2 || options.cargoType === 3) {
    return positiveInt(byType['2']) ?? positiveInt(byType['3']);
  }
  if (options.cargoType === 1) {
    return positiveInt(byType['1']);
  }
  return positiveInt(byType['1']) ?? positiveInt(byType['2']) ?? positiveInt(byType['3']);
}

/** 记住货型回退仓时，不覆盖已经指定的 extra.warehouseId */
export function nextShopWarehouseExtra(
  extra: Record<string, unknown>,
  warehouseId: number,
  cargoType?: number,
): { warehouseId: number; warehousesByCargoType: Record<string, number> } {
  const byType = readWarehousesByCargoType(extra.warehousesByCargoType);
  const nextByType = cargoType ? { ...byType, [String(cargoType)]: warehouseId } : byType;
  return {
    warehouseId: positiveInt(extra.warehouseId) ?? warehouseId,
    warehousesByCargoType: nextByType,
  };
}

function cargoCompatible(warehouseType: number | undefined, needed?: number | number[]): boolean {
  if (needed == null) {
    return true;
  }
  const wanted = Array.isArray(needed) ? needed : [needed];
  if (warehouseType == null) {
    return true;
  }
  if (wanted.includes(warehouseType)) {
    return true;
  }
  return wanted.some((type) => ODC_CARGO_TYPES.has(type)) && ODC_CARGO_TYPES.has(warehouseType);
}

export function rankWbStockWarehouses(
  warehouses: WbSellerWarehouse[],
  options?: { preferredId?: number; cargoType?: number | number[] },
): WbSellerWarehouse[] {
  const needed = options?.cargoType;
  const scored = warehouses
    .filter((item) => item.id > 0)
    .map((item) => {
      const compatible = cargoCompatible(item.cargoType, needed);
      let score = 0;
      if (needed != null && item.cargoType != null && compatible) {
        score += 400;
      }
      if (needed != null && item.cargoType != null && !compatible) {
        score -= 500;
      }
      if (options?.preferredId && item.id === options.preferredId && compatible) {
        score += 80;
      }
      if (/泉州/.test(item.name)) {
        score -= 300;
      }
      if (item.deliveryType === 1) {
        score += 50;
      }
      if (/склад|warehouse|fbs/i.test(item.name)) {
        score += 10;
      }
      const preferredType = Array.isArray(needed) ? needed[0] : needed;
      if (preferredType != null && item.cargoType === preferredType) {
        score += 20;
      }
      return { item, score };
    });
  scored.sort((left, right) => right.score - left.score || left.item.id - right.item.id);
  const seen = new Set<number>();
  return scored
    .map((row) => row.item)
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
}
