import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CATEGORY_MAP_SOURCE_TEXT,
  OzonCategoryUsage,
  WbCategoryMapping,
  WbSubjectSuggestion,
  deleteCategoryMappings,
  fetchCategoryMappings,
  fetchOzonCategoryUsage,
  saveCategoryMapping,
  suggestWbSubjects,
} from '../../../services/category-mapping';
import { Shop, fetchShopOptions } from '../../../services/shop';
import { useAuth } from '../../../auth';

type EditorState = {
  open: boolean;
  ozonCategoryPath: string;
  mapping?: WbCategoryMapping;
};

function sizedTag(sized: boolean | null) {
  if (sized === true) {
    return <Tag color="blue">系统回写：按尺码</Tag>;
  }
  if (sized === false) {
    return <Tag color="green">系统回写：无尺码</Tag>;
  }
  return <Tag>自动判定</Tag>;
}

export default function CategoryMappingPage() {
  const actionRef = useRef<ActionType>();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('product:shelf');
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<string>();
  const [usage, setUsage] = useState<OzonCategoryUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ open: false, ozonCategoryPath: '' });
  const [suggestions, setSuggestions] = useState<WbSubjectSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [form] = Form.useForm<{ wbSubjectId?: number; remark?: string }>();

  useEffect(() => {
    fetchShopOptions('WILDBERRIES')
      .then((list) => {
        const enabled = list.filter((item) => item.status === 'ENABLED' && item.hasToken);
        setShops(enabled);
        setShopId((current) => current ?? enabled[0]?.id);
      })
      .catch((error: Error) => message.error(error.message));
  }, []);

  const reloadUsage = useCallback(() => {
    setUsageLoading(true);
    fetchOzonCategoryUsage()
      .then(setUsage)
      .catch((error: Error) => message.error(error.message))
      .finally(() => setUsageLoading(false));
  }, []);

  useEffect(() => {
    reloadUsage();
  }, [reloadUsage]);

  const loadSuggestions = useCallback(
    async (ozonCategoryPath: string, keyword?: string) => {
      if (!shopId) {
        message.warning('请先选择一个已启用且已保存 Token 的 WB 店铺');
        return;
      }
      setSuggesting(true);
      try {
        setSuggestions(await suggestWbSubjects({ shopId, ozonCategoryPath, keyword }));
      } catch (error) {
        message.error(error instanceof Error ? error.message : '拉取 WB 类目失败');
      } finally {
        setSuggesting(false);
      }
    },
    [shopId],
  );

  const openEditor = (ozonCategoryPath: string, mapping?: WbCategoryMapping) => {
    setEditor({ open: true, ozonCategoryPath, mapping });
    setSuggestions(
      mapping ? [{ subjectId: mapping.wbSubjectId, subjectName: mapping.wbSubjectName, parentName: null }] : [],
    );
    form.setFieldsValue({
      wbSubjectId: mapping?.wbSubjectId,
      remark: mapping?.remark ?? undefined,
    });
    void loadSuggestions(ozonCategoryPath);
  };

  const submitEditor = async () => {
    const values = await form.validateFields();
    const ozonPath = editor.ozonCategoryPath.trim();
    if (!ozonPath) {
      message.error('请填写 Ozon 类目路径');
      return;
    }
    const subject =
      suggestions.find((item) => item.subjectId === values.wbSubjectId) ||
      (editor.mapping && editor.mapping.wbSubjectId === values.wbSubjectId
        ? { subjectId: editor.mapping.wbSubjectId, subjectName: editor.mapping.wbSubjectName }
        : null);
    if (!subject) {
      message.error('请选择一个 WB 类目');
      return;
    }
    await saveCategoryMapping({
      ozonCategoryPath: ozonPath,
      wbSubjectId: subject.subjectId,
      wbSubjectName: subject.subjectName,
      remark: values.remark,
    });
    message.success('已保存类目映射');
    setEditor({ open: false, ozonCategoryPath: '' });
    actionRef.current?.reload();
    reloadUsage();
  };

  const columns: ProColumns<WbCategoryMapping>[] = [
    { title: 'Ozon 类目', dataIndex: 'ozonCategoryPath', ellipsis: true, width: 320 },
    {
      title: 'WB 类目',
      dataIndex: 'wbSubjectName',
      search: false,
      render: (_, row) => `${row.wbSubjectName}（#${row.wbSubjectId}）`,
    },
    { title: '尺码（系统）', dataIndex: 'sized', search: false, width: 150, render: (_, row) => sizedTag(row.sized) },
    {
      title: '来源',
      dataIndex: 'source',
      search: false,
      width: 150,
      render: (_, row) => CATEGORY_MAP_SOURCE_TEXT[row.source],
    },
    { title: '命中次数', dataIndex: 'hitCount', search: false, width: 100 },
    {
      title: '最近失败原因',
      dataIndex: 'lastError',
      search: false,
      ellipsis: true,
      render: (_, row) =>
        row.lastError ? (
          <Tooltip title={row.lastError}>
            <Typography.Text type="danger">{row.lastError}</Typography.Text>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    { title: '更新时间', dataIndex: 'updatedAt', valueType: 'dateTime', search: false, width: 170 },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      hideInTable: !canEdit,
      render: (_, row) => [
        <a key="edit" onClick={() => openEditor(row.ozonCategoryPath, row)}>
          编辑
        </a>,
        <Popconfirm
          key="delete"
          title="删除后该类目下次上架会重新检索 WB 类目，确认删除？"
          onConfirm={async () => {
            await deleteCategoryMappings([row.id]);
            message.success('已删除');
            actionRef.current?.reload();
            reloadUsage();
          }}
        >
          <a>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  const usageColumns = [
    { title: 'Ozon 类目', dataIndex: 'ozonCategoryPath', ellipsis: true },
    { title: '商品数', dataIndex: 'productCount', width: 90 },
    {
      title: '映射状态',
      dataIndex: 'mapped',
      width: 220,
      render: (_: unknown, row: OzonCategoryUsage) =>
        row.mapped ? <Tag color="green">已映射 → {row.wbSubjectName}</Tag> : <Tag color="orange">未映射</Tag>,
    },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, row: OzonCategoryUsage) =>
        canEdit ? <a onClick={() => openEditor(row.ozonCategoryPath)}>指定 WB 类目</a> : null,
    },
  ];

  return (
    <PageContainer>
      <Typography.Paragraph type="secondary">
        Ozon 与 WB 的类目并不一一对应。这里只需指定 WB 类目；是否提交 Размер 由系统按商品规格自动判断
        （均码、家居、配件默认不填，只有采集到 S/M/42 等服装码才填）。WB 拒卡后会自动学习并回写到「尺码」列。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 12 }}>
        <span>建议来源店铺：</span>
        <Select
          style={{ width: 260 }}
          placeholder="选择用于查询 WB 类目的店铺"
          value={shopId}
          options={shops.map((item) => ({ label: item.name, value: item.id }))}
          onChange={setShopId}
        />
      </Space>

      <ProTable<WbCategoryMapping>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="已维护的类目映射"
        request={async (params) => {
          const data = await fetchCategoryMappings({
            current: params.current,
            pageSize: params.pageSize,
            keyword: params.ozonCategoryPath as string | undefined,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() =>
          canEdit
            ? [
                <Button key="create" type="primary" onClick={() => openEditor('')}>
                  新增映射
                </Button>,
              ]
            : []
        }
      />

      <Table<OzonCategoryUsage>
        style={{ marginTop: 24 }}
        rowKey="ozonCategoryPath"
        size="small"
        loading={usageLoading}
        title={() => '商品库中的 Ozon 类目（按商品数排序，优先补齐未映射的高频类目）'}
        columns={usageColumns}
        dataSource={usage}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />

      <Modal
        title="指定 WB 类目"
        open={editor.open}
        onCancel={() => setEditor({ open: false, ozonCategoryPath: '' })}
        onOk={submitEditor}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Ozon 类目路径" required>
            <Input
              value={editor.ozonCategoryPath}
              placeholder="例：Дом и сад / Текстиль / Подушки"
              onChange={(event) => setEditor((prev) => ({ ...prev, ozonCategoryPath: event.target.value }))}
            />
          </Form.Item>
          <Form.Item label="WB 类目" name="wbSubjectId" rules={[{ required: true, message: '请选择 WB 类目' }]}>
            <Select
              showSearch
              loading={suggesting}
              placeholder="输入俄语关键词搜索 WB 类目"
              filterOption={false}
              onSearch={(keyword) => {
                if (keyword.trim().length >= 2) {
                  void loadSuggestions(editor.ozonCategoryPath, keyword.trim());
                }
              }}
              options={suggestions.map((item) => ({
                label: item.parentName ? `${item.subjectName}（${item.parentName}）` : item.subjectName,
                value: item.subjectId,
              }))}
            />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
