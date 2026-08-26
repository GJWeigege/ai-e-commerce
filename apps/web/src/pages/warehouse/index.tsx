import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import { Button, Tabs, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ActionType } from '@ant-design/pro-components';
import { createInbound, createOutbound, fetchInbounds, fetchOutbounds, fetchWarehouses } from '../../services/order';
import { fetchSalesOrders } from '../../services/order';

export default function WarehousePage() {
  const inboundRef = useRef<ActionType>();
  const outboundRef = useRef<ActionType>();
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [purchases, setPurchases] = useState<Array<{ id: string; label: string }>>([]);
  const [inbounds, setInbounds] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    fetchWarehouses()
      .then((list) => setWarehouses(list.filter((item) => item.type === 'LOCAL_FULFILLMENT')))
      .catch((error: Error) => message.error(error.message));
    fetchSalesOrders({ pageSize: 50 })
      .then((data) => {
        const options = data.list
          .map((row) => {
            const po = row.orderLinks?.[0]?.purchaseOrder;
            if (!po || po.status !== 'ARRIVED_WB') return null;
            return { id: po.id, label: `${po.purchaseNo} / ${row.orderNo}` };
          })
          .filter((item): item is { id: string; label: string } => Boolean(item));
        setPurchases(options);
      })
      .catch((error: Error) => message.error(error.message));
  }, []);

  return (
    <PageContainer>
      <Tabs
        items={[
          {
            key: 'in',
            label: '入库登记',
            children: (
              <ProTable
                rowKey="id"
                actionRef={inboundRef}
                search={false}
                request={async (params) => {
                  const data = await fetchInbounds({ current: params.current, pageSize: params.pageSize });
                  setInbounds(
                    data.list.map((row) => ({
                      id: String(row.id),
                      label: String(row.inboundNo ?? row.id),
                    })),
                  );
                  return { data: data.list, total: data.total, success: true };
                }}
                columns={[
                  { title: '入库单', dataIndex: 'inboundNo' },
                  { title: 'SKU', render: (_, row) => String((row.salesOrder as { skuId?: string } | undefined)?.skuId || (row.purchaseOrder as { skuId?: string } | undefined)?.skuId || '-') },
                  { title: '数量', dataIndex: 'quantity' },
                  { title: '时间', dataIndex: 'inboundAt' },
                ]}
                toolBarRender={() => [
                  <ModalForm
                    key="in"
                    title="代发仓入库"
                    trigger={<Button type="primary">入库</Button>}
                    onFinish={async (values) => {
                      await createInbound(values as { purchaseOrderId: string; warehouseId: string; quantity: number });
                      message.success('入库成功，已绑定销售单与代采单');
                      inboundRef.current?.reload();
                      return true;
                    }}
                  >
                    <ProFormSelect name="purchaseOrderId" label="已达 WB 仓的代采单" options={purchases.map((item) => ({ label: item.label, value: item.id }))} rules={[{ required: true }]} />
                    <ProFormSelect name="warehouseId" label="代发仓" options={warehouses.map((item) => ({ label: item.name, value: item.id }))} rules={[{ required: true }]} />
                    <ProFormDigit name="quantity" label="数量" min={1} initialValue={1} />
                  </ModalForm>,
                ]}
              />
            ),
          },
          {
            key: 'out',
            label: '出库发货',
            children: (
              <ProTable
                rowKey="id"
                actionRef={outboundRef}
                search={false}
                request={async (params) => {
                  const data = await fetchOutbounds({ current: params.current, pageSize: params.pageSize });
                  return { data: data.list, total: data.total, success: true };
                }}
                columns={[
                  { title: '物流单号', dataIndex: 'trackingNo' },
                  { title: '承运商', dataIndex: 'carrier' },
                  { title: '数量', dataIndex: 'quantity' },
                  { title: '时间', dataIndex: 'outboundAt' },
                ]}
                toolBarRender={() => [
                  <ModalForm
                    key="out"
                    title="出库发货"
                    trigger={<Button type="primary">出库</Button>}
                    onFinish={async (values) => {
                      await createOutbound(values as { inboundRecordId: string; trackingNo: string; carrier?: string });
                      message.success('已出库并回填销售单物流号');
                      outboundRef.current?.reload();
                      return true;
                    }}
                  >
                    <ProFormSelect name="inboundRecordId" label="入库单" options={inbounds.map((item) => ({ label: item.label, value: item.id }))} rules={[{ required: true }]} />
                    <ProFormText name="trackingNo" label="物流单号" rules={[{ required: true }]} />
                    <ProFormText name="carrier" label="承运商" initialValue="CDEK" />
                  </ModalForm>,
                ]}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
