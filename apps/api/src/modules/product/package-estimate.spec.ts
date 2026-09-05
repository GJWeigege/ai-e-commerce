import {
  AI_PACKAGE_SPEC,
  buildPackageEstimatePrompt,
  mergeEstimatedPackageSpecs,
  parseJsonFromAgentText,
  parsePackageEstimateOutput,
  refinePackedEstimate,
  stripAiPackageSpecs,
} from '@aiecom/llm-core';
import { inspectPackageDimensions } from '@aiecom/shared';

describe('package estimate prompt and merge', () => {
  it('parses fenced JSON from Cursor Agent text', () => {
    const raw = parseJsonFromAgentText('好的\n```json\n{"lengthCm":32,"widthCm":22,"heightCm":8,"weightKg":0.45,"confidence":0.7,"categoryHint":"收纳","reason":"按家居收纳箱估算"}\n```');
    const parsed = parsePackageEstimateOutput(raw);
    expect(parsed).toMatchObject({
      length: 32,
      width: 22,
      height: 8,
      weightBrutto: 0.45,
      categoryHint: '收纳',
    });
  });

  it('clamps invalid edges and keeps weight in kg', () => {
    const parsed = parsePackageEstimateOutput({
      lengthCm: 0,
      widthCm: 12.2,
      heightCm: 9000,
      weightKg: 0.1234,
      confidence: 1.8,
    });
    expect(parsed.length).toBeUndefined();
    expect(parsed.width).toBe(13);
    expect(parsed.height).toBeUndefined();
    expect(parsed.weightBrutto).toBe(0.124);
    expect(parsed.confidence).toBe(1);
  });

  it('only writes missing weight when size already collected', () => {
    const specs = [
      { name: 'Длина, см', value: '30' },
      { name: 'Ширина, см', value: '20' },
      { name: 'Высота, см', value: '10' },
    ];
    const gaps = inspectPackageDimensions(specs, { name: 'Коробка' });
    expect(gaps.missingSize).toBe(false);
    expect(gaps.missingWeight).toBe(true);
    const merged = mergeEstimatedPackageSpecs(
      specs,
      {
        length: 40,
        width: 30,
        height: 20,
        weightBrutto: 0.8,
        confidence: 0.6,
        categoryHint: '箱',
        reason: '补毛重',
        assumptions: [],
      },
      gaps,
      { source: 'cursor-sdk', model: 'composer-2.5' },
    );
    expect(merged.find((item) => item.name === AI_PACKAGE_SPEC.weight)?.value).toBe('0.8');
    expect(merged.find((item) => item.name === AI_PACKAGE_SPEC.length)).toBeUndefined();
    const after = inspectPackageDimensions(merged, { name: 'Коробка' });
    expect(after.missingSize).toBe(false);
    expect(after.missingWeight).toBe(false);
  });

  it('replaces previous AI specs and asks the prompt to fill remaining gaps', () => {
    const specs = [
      { name: AI_PACKAGE_SPEC.length, value: '10' },
      { name: AI_PACKAGE_SPEC.width, value: '10' },
      { name: AI_PACKAGE_SPEC.height, value: '10' },
      { name: AI_PACKAGE_SPEC.source, value: 'cursor-sdk/old' },
    ];
    const stripped = stripAiPackageSpecs(specs);
    expect(stripped).toEqual([]);
    const prompt = buildPackageEstimatePrompt(
      { name: 'Футболка', categoryPath: 'Одежда', specs: stripped },
      inspectPackageDimensions(stripped, { name: 'Футболка' }),
    );
    expect(prompt).toContain('发货包裹');
    expect(prompt).toContain('折叠');
    expect(prompt).toContain('Футболка');
    expect(prompt).toContain('packProfile');
    expect(prompt).toContain('纺织/服装折叠袋');
  });

  it('folds a 170cm towel into a shipping parcel instead of the laid-out size', () => {
    const refined = refinePackedEstimate(
      { name: 'Полотенце махровое 170 см', categoryPath: 'Дом/Текстиль' },
      {
        length: 170,
        width: 80,
        height: 2,
        weightBrutto: 0.45,
        confidence: 0.6,
        categoryHint: '毛巾',
        reason: '按展开规格',
        assumptions: [],
      },
    );
    expect(Math.max(refined.length || 0, refined.width || 0, refined.height || 0)).toBeLessThanOrEqual(38);
    expect(refined.length).toBeGreaterThanOrEqual(22);
    expect(refined.reason).toContain('发货包裹');
  });

  it('packs a 28cm pan as a retail box, not a 28cm cube', () => {
    const refined = refinePackedEstimate(
      { name: 'Сковорода 28 см', categoryPath: 'Дом/Посуда' },
      { length: 28, width: 28, height: 28, weightBrutto: 1.2, confidence: 0.5, categoryHint: '', reason: '', assumptions: [] },
    );
    expect(refined.height).toBeLessThanOrEqual(18);
    expect(Math.max(refined.length || 0, refined.width || 0)).toBeGreaterThanOrEqual(22);
  });

  it('rolls a 5m LED strip instead of using the 500cm run length', () => {
    const refined = refinePackedEstimate(
      { name: 'LED лента 5 м', categoryPath: 'Электроника' },
      { length: 500, width: 1, height: 1, weightBrutto: 0.2, confidence: 0.5, categoryHint: '', reason: '', assumptions: [] },
    );
    expect(Math.max(refined.length || 0, refined.width || 0, refined.height || 0)).toBeLessThanOrEqual(70);
  });

  it('flat-packs a 200cm sofa instead of the assembled length', () => {
    const refined = refinePackedEstimate(
      { name: 'Диван 200 см', categoryPath: 'Мебель' },
      { length: 200, width: 90, height: 80, weightBrutto: 18, confidence: 0.5, categoryHint: '', reason: '', assumptions: [] },
    );
    expect(refined.length).toBeLessThanOrEqual(140);
    expect(refined.height).toBeLessThanOrEqual(30);
  });
});
