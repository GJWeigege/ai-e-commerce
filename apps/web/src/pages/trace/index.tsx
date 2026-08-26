import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Button, Input, Timeline, message } from 'antd';
import { useState } from 'react';
import { fetchTrace } from '../../services/order';

export default function TracePage() {
  const [orderNo, setOrderNo] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  return (
    <PageContainer>
      <ProCard>
        <Input.Search
          placeholder="输入销售单号"
          enterButton="查询全链路"
          value={orderNo}
          onChange={(event) => setOrderNo(event.target.value)}
          onSearch={async (value) => {
            try {
              const result = await fetchTrace(value);
              setData(result as Record<string, unknown>);
            } catch (error) {
              message.error(error instanceof Error ? error.message : '查询失败');
            }
          }}
        />
      </ProCard>
      {data ? (
        <ProCard title="链路详情" style={{ marginTop: 16 }}>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
          <Timeline
            style={{ marginTop: 16 }}
            items={((data.tracks as Array<{ nodeName: string; description?: string; occurredAt: string }>) || []).map((item) => ({
              children: `${item.nodeName} · ${item.description || ''} · ${item.occurredAt}`,
            }))}
          />
        </ProCard>
      ) : (
        <Button type="link" disabled>
          查询后展示：商品 → 代采 → 入库 → 出库物流
        </Button>
      )}
    </PageContainer>
  );
}
