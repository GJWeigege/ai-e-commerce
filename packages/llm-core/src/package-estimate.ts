import {
  inspectPackageDimensions,
  PackageDimensionGaps,
  PackageDimensions,
  WB_MAX_PACKAGE_EDGE_CM,
} from '@aiecom/shared';

export const PACKAGE_ESTIMATE_PROMPT_VERSION = 'v1';

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

export function buildPackageEstimatePrompt(product: PackageEstimateProduct, gaps: PackageDimensionGaps): string {
  const need = [
    gaps.missingSize ? '长宽高(cm，包装后外廓)' : null,
    gaps.missingWeight ? '毛重(kg，含包装)' : null,
  ].filter(Boolean);
  return [
    '你是俄罗斯跨境电商仓配专家，为 Wildberries 官方仓中转预估发货包裹。',
    '只输出一个 JSON 对象，不要 markdown，不要解释，不要读写文件或执行命令。',
    '单位：lengthCm/widthCm/heightCm 为厘米整数；weightKg 为千克，最多三位小数。',
    '数值必须是包装后的外廓和毛重（含纸箱/气泡袋/缠膜），不是商品净尺寸或净重。',
    '单边不超过 700cm；毛重建议 0.05–30kg。按品类常识估算：服装折叠、小配件气泡袋、瓶装加缓冲、家居按外箱。',
    '若标题/规格已出现克重或体积，优先据此换算并加包装余量，不要忽略。',
    `本单需要补齐：${need.join('、') || '尺寸与重量'}。已采集到的字段请在 JSON 里原样给出合理值，缺口必须给出估计。`,
    '字段：lengthCm, widthCm, heightCm, weightKg, confidence(0~1), categoryHint, reason(中文简述), assumptions(string[])。',
    JSON.stringify({
      skuId: product.skuId,
      name: product.name,
      categoryPath: product.categoryPath,
      brand: product.brand,
      description: product.description ? String(product.description).slice(0, 1200) : undefined,
      specs: (product.specs ?? []).slice(0, 40),
      skuOptions: (product.skuOptions ?? []).slice(0, 8).map((item) => ({
        name: item.name,
        options: item.options,
      })),
      collected: gaps.dimensions,
      missingSize: gaps.missingSize,
      missingWeight: gaps.missingWeight,
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
