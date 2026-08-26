import { StandardProduct } from '@aiecom/shared';
import { AiSelectionOutput, ILlmProvider, clampScore } from './llm.interface';

/** 无大模型 Key 时的可运行选品引擎，保证一期链路不阻塞 */
export class RuleBasedLlmProvider implements ILlmProvider {
  readonly provider = 'rule-based';
  readonly model = 'heuristic-v1';

  async completeJson(prompt: string): Promise<AiSelectionOutput> {
    const jsonStart = prompt.indexOf('{');
    const jsonEnd = prompt.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      throw new Error('选品提示词中缺少商品 JSON');
    }
    const product = JSON.parse(prompt.slice(jsonStart, jsonEnd + 1)) as StandardProduct;
    return scoreProduct(product);
  }
}

export function scoreProduct(product: StandardProduct): AiSelectionOutput {
  const ratingScore = ((product.rating ?? 0) / 5) * 30;
  const salesScore = Math.min(product.salesCount / 1000, 1) * 25;
  const priceScore = product.price >= 200 && product.price <= 8000 ? 25 : 8;
  const stockScore = product.stock > 0 ? 20 : 0;
  const score = clampScore(ratingScore + salesScore + priceScore + stockScore);

  const riskPoints: string[] = [];
  if (product.stock <= 0) riskPoints.push('库存为 0，履约风险高');
  if ((product.rating ?? 0) < 4) riskPoints.push('评分偏低，退货率可能偏高');
  if (product.salesCount < 20) riskPoints.push('销量样本不足，需求不确定');
  if (product.price < 150) riskPoints.push('客单价过低，物流成本占比高');

  const recommended = score >= 60 && product.stock > 0;
  return {
    score,
    profitEstimate: Number((product.price * 0.18).toFixed(2)),
    profitCurrency: 'RUB',
    riskPoints,
    fitReason: recommended
      ? `综合得分 ${score}，价格与销量和库存结构适合 WB 中转代发`
      : '',
    unfitReason: recommended ? '' : `综合得分 ${score}，存在 ${riskPoints.join('；') || '多项短板'}`,
    recommended,
  };
}
