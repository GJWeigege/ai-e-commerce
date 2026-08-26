import { StandardProduct } from '@aiecom/shared';

export type AiSelectionOutput = {
  score: number;
  profitEstimate: number;
  profitCurrency: string;
  riskPoints: string[];
  fitReason: string;
  unfitReason: string;
  recommended: boolean;
};

export interface ILlmProvider {
  readonly provider: string;
  readonly model: string;
  completeJson(prompt: string): Promise<unknown>;
}

export const SELECTION_PROMPT_VERSION = 'v1';

export function buildSelectionPrompt(product: StandardProduct): string {
  return [
    '你是俄罗斯跨境电商选品顾问。根据商品 JSON 输出严格 JSON，不要 markdown。',
    '字段：score(0-100整数), profitEstimate(数字), profitCurrency(RUB), riskPoints(string[]), fitReason, unfitReason, recommended(boolean)。',
    JSON.stringify(product),
  ].join('\n');
}

export function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function parseSelectionOutput(raw: unknown): AiSelectionOutput {
  const data = raw as Partial<AiSelectionOutput>;
  const score = clampScore(Number(data.score ?? 0));
  const recommended = Boolean(data.recommended ?? score >= 60);
  return {
    score,
    profitEstimate: Number(data.profitEstimate ?? 0),
    profitCurrency: data.profitCurrency || 'RUB',
    riskPoints: Array.isArray(data.riskPoints) ? data.riskPoints.map(String) : [],
    fitReason: String(data.fitReason ?? ''),
    unfitReason: String(data.unfitReason ?? ''),
    recommended,
  };
}
