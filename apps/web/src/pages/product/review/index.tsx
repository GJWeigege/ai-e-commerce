import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormTextArea } from '@ant-design/pro-components';
import { Button, Image, Space, message } from 'antd';
import { useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Product, fetchProducts, reviewProducts, updateProduct } from '../../../services/product';
import { ProductPreviewDrawer } from '../ProductPreview';

export default function ProductReviewPage() {
  const actionRef = useRef<ActionType>();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Product | null>(null);

  const columns: ProColumns<Product>[] = [
    {
      title: '图片',
      search: false,
      width: 72,
      render: (_, row) =>
        row.mainImageUrl || row.imageUrls?.[0] ? (
          <Image src={row.mainImageUrl || row.imageUrls?.[0]} width={48} height={48} style={{ objectFit: 'cover' }} />
        ) : (
          '-'
        ),
    },
    { title: 'SKU', dataIndex: 'skuId', search: false, copyable: true },
    { title: '名称', dataIndex: 'name', search: false, ellipsis: true },
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '名称 / SKU' },
    },
    {
      title: '图集',
      search: false,
      width: 72,
      render: (_, row) => row.imageUrls?.length || (row.mainImageUrl ? 1 : 0),
    },
    { title: '售价', dataIndex: 'price', search: false },
    { title: '库存', dataIndex: 'stock', search: false },
    { title: 'AI 得分', search: false, render: (_, row) => row.aiSelection?.score ?? '-' },
    { title: '利润预估', search: false, render: (_, row) => row.aiSelection?.profitEstimate ?? '-' },
    { title: '推荐', dataIndex: 'recommended', valueType: 'select', valueEnum: { true: { text: '是' }, false: { text: '否' } }, render: (_, row) => (row.aiSelection?.recommended ? '是' : '否') },
    { title: '风险点', search: false, ellipsis: true, render: (_, row) => (row.aiSelection?.riskPoints || []).join('；') },
    { title: '理由', search: false, ellipsis: true, render: (_, row) => row.aiSelection?.fitReason || row.aiSelection?.unfitReason },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        CRAWLED: { text: '已采集' },
        AI_PENDING: { text: 'AI 处理中' },
        AI_DONE: { text: 'AI 完成' },
        REVIEW_PENDING: { text: '待复审' },
      },
    },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => [
        <a key="view" onClick={() => setPreview(row)}>
          详情
        </a>,
        <ModalForm
          key="edit"
          title="编辑商品"
          trigger={<a>编辑</a>}
          initialValues={{ name: row.name, price: Number(row.price), stock: row.stock, remark: row.remark }}
          onFinish={async (values) => {
            await updateProduct(row.id, values as { name: string; price: number; stock: number; remark?: string });
            message.success('已保存');
            actionRef.current?.reload();
            return true;
          }}
        >
          <ProFormText name="name" label="名称" rules={[{ required: true }]} />
          <ProFormDigit name="price" label="售价" min={0} />
          <ProFormDigit name="stock" label="库存" min={0} />
          <ProFormTextArea name="remark" label="备注" />
        </ModalForm>,
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<Product>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        rowSelection={{ onChange: (keys) => setSelected(keys as string[]) }}
        headerTitle="选品复审"
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        request={async (params) => {
          const recommended =
            params.recommended === true || params.recommended === 'true'
              ? true
              : params.recommended === false || params.recommended === 'false'
                ? false
                : undefined;
          const data = await fetchProducts({
            current: params.current,
            pageSize: params.pageSize,
            keyword: (params.keyword as string) || undefined,
            status: (params.status as string) || undefined,
            recommended,
            reviewOnly: params.status ? false : true,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() => [
          <Space key="batch">
            <Button
              type="primary"
              disabled={!selected.length}
              onClick={async () => {
                await reviewProducts(selected, 'APPROVE');
                message.success('已通过，可到商品库上架');
                setSelected([]);
                actionRef.current?.reload();
              }}
            >
              批量通过
            </Button>
            <Button
              danger
              disabled={!selected.length}
              onClick={async () => {
                await reviewProducts(selected, 'REJECT');
                message.success('已驳回');
                setSelected([]);
                actionRef.current?.reload();
              }}
            >
              批量驳回
            </Button>
          </Space>,
        ]}
      />
      <ProductPreviewDrawer product={preview} onClose={() => setPreview(null)} />
    </PageContainer>
  );
}
