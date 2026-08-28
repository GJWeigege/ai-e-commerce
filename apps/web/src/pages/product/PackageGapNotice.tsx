import type { CSSProperties } from 'react';
import { Alert, Tag } from 'antd';
import type { PackageDimensionGaps } from '@aiecom/shared';

export const PACKAGE_GAP_STYLE: CSSProperties = {
  background: '#ff0080',
  color: '#fff',
  borderColor: '#ff0080',
  fontWeight: 700,
};

export function PackageGapTags({ gaps }: { gaps: PackageDimensionGaps }) {
  if (!gaps.missingSize && !gaps.missingWeight) {
    return <Tag color="green">尺寸/重量已采集</Tag>;
  }
  return (
    <span>
      {gaps.missingSize ? <Tag style={PACKAGE_GAP_STYLE}>缺尺寸</Tag> : null}
      {gaps.missingWeight ? <Tag style={PACKAGE_GAP_STYLE}>缺重量</Tag> : null}
    </span>
  );
}

export function PackageGapBanner({
  gaps,
  listing,
}: {
  gaps: PackageDimensionGaps;
  listing?: boolean;
}) {
  if (!gaps.missingSize && !gaps.missingWeight) {
    return null;
  }
  const parts = [
    gaps.missingSize ? '尺寸' : null,
    gaps.missingWeight ? '重量' : null,
  ].filter(Boolean);
  return (
    <Alert
      type="error"
      showIcon
      style={{
        marginBottom: 16,
        background: '#ff0080',
        border: '2px solid #c40064',
      }}
      message={
        <span style={{ color: '#fff', fontWeight: 700 }}>
          未采集到商品{parts.join('、')}
          {listing ? '。执意上架将留白提交给野莓，可能被拒卡或产生物流罚款。' : '。请核对后再上架。'}
        </span>
      }
    />
  );
}
