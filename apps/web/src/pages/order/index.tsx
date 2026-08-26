import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect, ProCard } from '@ant-design/pro-components';
import { Button, Tabs, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { SalesOrder, advancePurchase, createSalesOrder, fetchAlerts, fetchSalesOrders, resolveAlert } from '../../services/order';
import { Product, fetchProducts, productSkuOptions } from '../../services/product';

export default function OrderPage() {
  const actionRef = useRef<ActionType>();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>();

  useEffect(() => {
    fetchProducts({ pageSize: 50, status: 'ON_SHELF' })
      .then((data) => setProducts(data.list))
      .catch((error: Error) => message.error(error.message));
  }, []);

  const selectedProduct = products.find((item) => item.id === selectedProductId);
  const skuChoices = selectedProduct
    ? (productSkuOptions(selectedProduct).length
        ? productSkuOptions(selectedProduct)
        : [{ skuId: selectedProduct.skuId, name: selectedProduct.name, sourceUrl: selectedProduct.sourceUrl, price: Number(selectedProduct.price), imageUrls: selectedProduct.imageUrls || [], options: {} }])
    : [];

  const columns: ProColumns<SalesOrder>[] = [
    { title: '销售单号', dataIndex: 'orderNo' },
    { title: 'SKU', dataIndex: 'skuId' },
    { title: '商品', search: false, render: (_, row) => row.product?.name },
    { title: '数量', dataIndex: 'quantity', search: false },
    { title: '收货人', dataIndex: 'receiverName', search: false },
    { title: '状态', dataIndex: 'status' },
    { title: '物流单号', dataIndex: 'outboundTrackingNo', search: false },
    {
      title: '代采',
      search: false,
      render: (_, row) => {
        const po = row.orderLinks?.[0]?.purchaseOrder;
        if (!po) return '-';
        return `${po.purchaseNo} / ${po.status}`;
      },
    },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => {
        const po = row.orderLinks?.[0]?.purchaseOrder;
        if (!po) return [];
        return [
          <a
            key="ok"
            onClick={async () => {
              await advancePurchase(po.id);
              message.success('已推进');
              actionRef.current?.reload();
            }}
          >
            推进代采
          </a>,
          po.status === 'PENDING_PURCHASE' ? (
            <a
              key="fail"
              onClick={async () => {
                await advancePurchase(po.id, true);
                message.warning('已标记失败');
                actionRef.current?.reload();
              }}
            >
              标记失败
            </a>
          ) : null,
        ];
      },
    },
  ];

  return (
    <PageContainer>
      <Tabs
        items={[
          {
            key: 'orders',
            label: '销售/代采订单',
            children: (
              <ProTable<SalesOrder>
                rowKey="id"
                actionRef={actionRef}
                columns={columns}
                request={async (params) => {
                  const data = await fetchSalesOrders({
                    current: params.current,
                    pageSize: params.pageSize,
                    keyword: params.orderNo || params.skuId,
                    status: params.status as string,
                  });
                  return { data: data.list, total: data.total, success: true };
                }}
                toolBarRender={() => [
                  <ModalForm
                    key="create"
                    title="录入销售订单"
                    trigger={<Button type="primary">新建销售单</Button>}
                    onFinish={async (values) => {
                      await createSalesOrder(values);
                      message.success('已生成销售单与代采单');
                      actionRef.current?.reload();
                      return true;
                    }}
                  >
                    <ProFormSelect
                      name="productId"
                      label="上架商品"
                      options={products.map((item) => ({ label: `${item.name} (${item.skuId})`, value: item.id }))}
                      rules={[{ required: true }]}
                      fieldProps={{
                        onChange: (value: string) => setSelectedProductId(value),
                      }}
                    />
                    <ProFormSelect
                      name="skuId"
                      label="规格 SKU"
                      disabled={!selectedProductId}
                      dependencies={['productId']}
                      options={skuChoices.map((item) => ({
                        label: `${Object.values(item.options || {}).join(' / ') || item.name} · ${item.skuId}`,
                        value: item.skuId,
                      }))}
                      rules={[{ required: true, message: '请选择要采购/履约的规格 SKU' }]}
                    />
                    <ProFormDigit name="quantity" label="数量" min={1} initialValue={1} rules={[{ required: true }]} />
                    <ProFormText name="receiverName" label="收货人" rules={[{ required: true }]} />
                    <ProFormText name="receiverPhone" label="电话" rules={[{ required: true }]} />
                    <ProFormText name="receiverCity" label="城市" rules={[{ required: true }]} />
                    <ProFormText name="receiverAddress" label="地址" rules={[{ required: true }]} />
                    <ProFormText name="receiverPostalCode" label="邮编" />
                  </ModalForm>,
                ]}
              />
            ),
          },
          {
            key: 'alerts',
            label: '异常告警',
            children: (
              <ProTable
                rowKey="id"
                search={false}
                request={async (params) => {
                  const data = await fetchAlerts({ current: params.current, pageSize: params.pageSize });
                  return { data: data.list, total: data.total, success: true };
                }}
                columns={[
                  { title: '标题', dataIndex: 'title' },
                  { title: '内容', dataIndex: 'message' },
                  { title: '状态', dataIndex: 'status' },
                  { title: '时间', dataIndex: 'createdAt' },
                  {
                    title: '操作',
                    render: (_, row: { id: string; status: string }) =>
                      row.status === 'OPEN' ? (
                        <a
                          onClick={async () => {
                            await resolveAlert(row.id);
                            message.success('已处理');
                          }}
                        >
                          关闭
                        </a>
                      ) : null,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
