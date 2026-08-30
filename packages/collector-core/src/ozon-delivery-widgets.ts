export type OzonLayoutWidget = {
  stateId: string;
  asyncData: unknown;
  component: string;
};

/**
 * 同数字 id 只是兜底。实测 3430453777：缺货时是 webOutOfStock-1832611，
 * 有货时是 webDelivery-8727767，id 并不相同。真正该 POST 的是 layout 里
 * component===webDelivery 且带自家 asyncData 的节点。
 */
export function expandOzonDeliveryStateIds(stateIds: string[]): string[] {
  const found: string[] = [];
  const add = (stateId: string) => {
    const id = String(stateId || '').trim();
    if (!id || found.includes(id)) return;
    found.push(id);
  };
  for (const stateId of stateIds) {
    add(stateId);
    // 只从物流组件扩 webDelivery。把 webCharacteristics-3282540 改写成
    // webDelivery-3282540 会占满 24 个 POST 名额，真实配送组件进不去。
    if (!/webOutOfStock|webShipping|webDelivery/i.test(stateId)) continue;
    const idMatch = String(stateId).match(/-(\d+)(?:-|$)/);
    if (!idMatch) continue;
    add(`webDelivery-${idMatch[1]}-default-1`);
    add(`webSale-${idMatch[1]}-default-1`);
  }
  return found;
}

export function isOzonLogisticsWidgetKey(key: string): boolean {
  return /webSale|webDelivery|webOutOfStock|webShipping|webPdp|webProductMainWidget|webDetailSKU/i.test(
    String(key || ''),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function layoutStateId(node: Record<string, unknown>): string {
  if (node.stateId) return String(node.stateId);
  const component = String(node.component || node.name || node.widgetName || '');
  if (component && node.id != null) {
    return `${component}-${node.id}-default-1`;
  }
  return '';
}

/** 对齐 seerfar：整棵 layout 树按 component === webDelivery / webOutOfStock 找 id + asyncData */
export function findOzonDeliveryLayoutWidgets(layout: unknown, depth = 0): OzonLayoutWidget[] {
  const found: OzonLayoutWidget[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, level: number) => {
    if (level > 24 || node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, level + 1));
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;
    const component = String(rec.component || rec.name || rec.widgetName || '');
    if (/webDelivery|webOutOfStock|webShipping/i.test(component)) {
      const stateId = layoutStateId(rec);
      if (stateId) {
        const existing = found.find((item) => item.stateId === stateId);
        if (existing) {
          if (
            (existing.asyncData == null || existing.asyncData === '') &&
            rec.asyncData != null &&
            rec.asyncData !== ''
          ) {
            existing.asyncData = rec.asyncData;
          }
        } else {
          seen.add(stateId);
          found.push({
            stateId,
            asyncData: rec.asyncData != null ? rec.asyncData : '',
            component,
          });
        }
      }
    }
    Object.keys(rec).forEach((key) => {
      if (key === 'widgetStates') return;
      walk(rec[key], level + 1);
    });
  };
  walk(layout, depth);
  return found;
}

export function planOzonDeliveryWidgetPosts(stateIds: string[]): string[] {
  return expandOzonDeliveryStateIds(stateIds).filter((stateId) =>
    /webDelivery|webOutOfStock|webShipping|webSale/i.test(stateId),
  );
}

export function isRealOzonDeliveryStateId(stateId: string): boolean {
  return /^(webDelivery|webOutOfStock|webShipping)(?:-|$)/i.test(String(stateId || ''));
}

/** 采集排队：只 POST layout 里真是配送的组件，外加特性/主卡，禁止把任意 id 改写成 webDelivery */
export function queueOzonComposerWidgets(
  widgets: Array<{ stateId: string; component?: string; asyncData?: unknown; important?: boolean }>,
  limit = 24,
): Array<{ stateId: string; component?: string; asyncData?: unknown; important?: boolean }> {
  const deliveries = widgets.filter((item) =>
    isRealOzonDeliveryStateId(item.stateId) || /^(webDelivery|webOutOfStock|webShipping)$/i.test(String(item.component || '')),
  );
  const others = widgets.filter(
    (item) =>
      item.important &&
      !deliveries.some((delivery) => delivery.stateId === item.stateId) &&
      !isRealOzonDeliveryStateId(item.stateId),
  );
  return deliveries.concat(others).slice(0, limit);
}
