import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormUploadButton, ProFormTextArea, ProFormSwitch, ProFormGroup } from '@ant-design/pro-components';
import { Button, Drawer, Tag, message } from 'antd';
import { useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  CrawlerItem,
  CrawlerTask,
  createCategoryTask,
  createCsvTask,
  createUrlTask,
  exportTask,
  fetchCrawlerItems,
  fetchCrawlerTasks,
  retryFailed,
  retryItem,
} from '../../../services/crawler';

function CollectFilterFields() {
  return (
    <>
      <ProFormGroup title="采集限制（可选）">
        <ProFormDigit
          name="minRating"
          label="Ozon 评分不低于"
          min={0}
          max={5}
          fieldProps={{ step: 0.1, precision: 1 }}
          extra="留空不限制。品类采集会写入 Ozon 列表筛选，商品详情仍会再校验。"
        />
        <ProFormDigit name="minReviewCount" label="评价数不少于" min={0} fieldProps={{ precision: 0 }} />
        <ProFormDigit name="minSalesCount" label="销量不少于" min={0} fieldProps={{ precision: 0 }} />
      </ProFormGroup>
      <ProFormGroup>
        <ProFormDigit name="minPrice" label="价格不低于（₽）" min={0} fieldProps={{ precision: 0 }} />
        <ProFormDigit name="maxPrice" label="价格不高于（₽）" min={0} fieldProps={{ precision: 0 }} />
        <ProFormSwitch name="inStockOnly" label="仅采集有货" initialValue={false} />
      </ProFormGroup>
    </>
  );
}

function appendFilterFields(form: FormData, values: Record<string, unknown>) {
  for (const key of ['minRating', 'minReviewCount', 'minSalesCount', 'minPrice', 'maxPrice'] as const) {
    const value = values[key];
    if (value != null && value !== '') {
      form.append(key, String(value));
    }
  }
  form.append('inStockOnly', values.inStockOnly ? 'true' : 'false');
}

function itemStatusText(status: string) {
  if (status === 'SKIPPED') return '未达条件';
  if (status === 'SUCCESS') return '成功';
  if (status === 'FAILED') return '失败';
  if (status === 'RUNNING') return '进行中';
  if (status === 'RETRYING') return '重试中';
  return status;
}

function itemStatusColor(status: string) {
  if (status === 'SKIPPED') return 'default';
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'RUNNING' || status === 'RETRYING') return 'processing';
  return undefined;
}

export default function CrawlerTaskPage() {
  const actionRef = useRef<ActionType>();
  const [taskId, setTaskId] = useState<string | null>(null);

  const columns: ProColumns<CrawlerTask>[] = [
    { title: '任务', dataIndex: 'name' },
    { title: '模式', dataIndex: 'mode', valueEnum: { CATEGORY_TOP: { text: '品类 TOP' }, CSV_URL: { text: 'CSV URL' } } },
    { title: '采集器', dataIndex: 'collectorType', search: false, valueEnum: { CHROME_EXT: { text: 'Chrome 插件' }, ELECTRON: { text: 'Electron' } } },
    { title: '状态', dataIndex: 'status' },
    { title: '总数/成功/失败', search: false, render: (_, row) => `${row.totalCount} / ${row.successCount} / ${row.failCount}` },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', search: false },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => [
        <a key="items" onClick={() => setTaskId(row.id)}>明细</a>,
        <a
          key="retry"
          onClick={async () => {
            const result = await retryFailed(row.id);
            message.success(`已重试 ${(result as { count: number }).count} 条`);
            actionRef.current?.reload();
          }}
        >
          批量重试
        </a>,
        <a
          key="export"
          onClick={async () => {
            const res = await exportTask(row.id);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${row.name}.csv`;
            a.click();
          }}
        >
          导出
        </a>,
      ],
    },
  ];

  const itemColumns: ProColumns<CrawlerItem>[] = [
    { title: 'URL', dataIndex: 'sourceUrl', ellipsis: true },
    { title: 'SKU', dataIndex: 'skuId' },
    { title: '状态', dataIndex: 'status', render: (_, row) => <Tag color={itemStatusColor(row.status)}>{itemStatusText(row.status)}</Tag> },
    { title: '失败原因', dataIndex: 'failReason', ellipsis: true },
    {
      title: '操作',
      render: (_, row) =>
        row.status === 'FAILED' ? (
          <a
            onClick={async () => {
              await retryItem(row.id);
              message.success('已重试');
            }}
          >
            重试
          </a>
        ) : null,
    },
  ];

  return (
    <PageContainer>
      <ProTable<CrawlerTask>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="采集任务"
        request={async (params) => {
          const data = await fetchCrawlerTasks({
            current: params.current,
            pageSize: params.pageSize,
            keyword: params.name,
            status: params.status as string,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() => [
          <ModalForm
            key="cat"
            title="品类 TOP 采集"
            trigger={<Button type="primary">品类采集</Button>}
            onFinish={async (values) => {
              if (!values.categoryId && !values.categoryName) {
                message.error('请填写品类 ID、品类链接或品类名称');
                return false;
              }
              await createCategoryTask(values as Parameters<typeof createCategoryTask>[0]);
              message.success('任务已入队。请在 Chrome 插件点「开始轮询」，插件会打开品类页拆商品链接。');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="任务名称" rules={[{ required: true }]} />
            <ProFormText
              name="categoryId"
              label="品类 ID / 品类链接"
              placeholder="7511 或 https://www.ozon.ru/category/bluzy-i-rubashki-zhenskie-7511/"
              extra="打开 Ozon 品类页，复制链接末尾数字或整段链接。不要填中文去 ozon.ru 搜索。"
            />
            <ProFormText name="categoryName" label="品类名称（可选）" placeholder="блузки и рубашки женские" />
            <ProFormDigit
              name="topN"
              label="TOP N"
              min={1}
              max={50}
              initialValue={5}
              extra="达标商品数量。品类页会多拆候选链接，未达评分/销量等条件时自动补齐。"
            />
            <ProFormSwitch
              name="crawlAllSkus"
              label="采集全部规格 SKU"
              extra="默认关闭：只保留当前页主 SKU，不跟进每个规格链接。打开后才会把重量/口味等规格全部采进来。"
              initialValue={false}
            />
            <CollectFilterFields />
          </ModalForm>,
          <ModalForm
            key="urls"
            title="商品链接采集（真实 Ozon URL）"
            trigger={<Button type="primary">链接采集</Button>}
            onFinish={async (values) => {
              const urls = String(values.urls || '')
                .split(/\r?\n/)
                .map((item: string) => item.trim())
                .filter(Boolean);
              if (urls.length === 0) {
                message.error('请粘贴至少一个 Ozon 商品链接');
                return false;
              }
              await createUrlTask({
                name: values.name,
                urls,
                crawlAllSkus: Boolean(values.crawlAllSkus),
                minRating: values.minRating,
                minReviewCount: values.minReviewCount,
                minSalesCount: values.minSalesCount,
                minPrice: values.minPrice,
                maxPrice: values.maxPrice,
                inStockOnly: Boolean(values.inStockOnly),
              });
              message.success('任务已入队。请打开 Chrome 插件并开始轮询领取任务。');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="任务名称" rules={[{ required: true }]} initialValue="Ozon 真实商品" />
            <ProFormTextArea
              name="urls"
              label="商品链接"
              placeholder="每行一个 https://www.ozon.ru/product/..."
              rules={[{ required: true }]}
            />
            <ProFormSwitch
              name="crawlAllSkus"
              label="采集全部规格 SKU"
              extra="默认关闭：只采主 SKU，不打开每个规格页。"
              initialValue={false}
            />
            <CollectFilterFields />
          </ModalForm>,
          <ModalForm
            key="csv"
            title="CSV URL 采集"
            trigger={<Button>CSV 导入</Button>}
            onFinish={async (values) => {
              const form = new FormData();
              form.append('name', values.name);
              form.append('crawlAllSkus', values.crawlAllSkus ? 'true' : 'false');
              appendFilterFields(form, values);
              const file = values.file?.[0]?.originFileObj as File | undefined;
              if (!file) {
                message.error('请上传 CSV');
                return false;
              }
              form.append('file', file);
              await createCsvTask(form);
              message.success('任务已入队');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="任务名称" rules={[{ required: true }]} />
            <ProFormSwitch
              name="crawlAllSkus"
              label="采集全部规格 SKU"
              extra="默认关闭：只采主 SKU。"
              initialValue={false}
            />
            <CollectFilterFields />
            <ProFormUploadButton name="file" label="CSV 文件" max={1} fieldProps={{ beforeUpload: () => false, accept: '.csv' }} />
          </ModalForm>,
        ]}
      />
      <Drawer title="采集明细" width={720} open={Boolean(taskId)} onClose={() => setTaskId(null)} destroyOnClose>
        {taskId ? (
          <ProTable<CrawlerItem>
            rowKey="id"
            search={false}
            columns={itemColumns}
            request={async (params) => {
              const data = await fetchCrawlerItems(taskId, { current: params.current, pageSize: params.pageSize });
              actionRef.current?.reload();
              return { data: data.list, total: data.total, success: true };
            }}
          />
        ) : null}
      </Drawer>
    </PageContainer>
  );
}
