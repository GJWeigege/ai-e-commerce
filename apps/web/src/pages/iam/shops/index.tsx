import { PageContainer, ProTable, ModalForm, ProFormSelect, ProFormText } from '@ant-design/pro-components';
import { Button, Popconfirm, Tag, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  PLATFORM_TEXT,
  SHOP_STATUS_TEXT,
  Shop,
  changeShopStatus,
  createShop,
  fetchShops,
  shopWbBrand,
  updateShop,
} from '../../../services/shop';
import { fetchTenantOptions, Tenant } from '../../../services/tenant';
import { useAuth } from '../../../auth';

export default function ShopPage() {
  const actionRef = useRef<ActionType>();
  const { user, hasPermission } = useAuth();
  const isSuperAdmin = user?.roles.includes('SUPER_ADMIN') ?? false;
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchTenantOptions()
      .then(setTenants)
      .catch((error: Error) => message.error(error.message));
  }, [isSuperAdmin]);

  const tenantOptions = tenants.map((item) => ({
    label: `${item.name} (${item.code})`,
    value: item.id,
  }));

  const columns: ProColumns<Shop>[] = [
    { title: '店铺名称', dataIndex: 'name' },
    ...(isSuperAdmin
      ? [
          {
            title: '租户',
            dataIndex: 'tenantId',
            valueType: 'select',
            fieldProps: { options: tenantOptions, allowClear: true, showSearch: true },
            render: (_: unknown, row: Shop) =>
              row.tenant ? `${row.tenant.name} (${row.tenant.code})` : '-',
          } as ProColumns<Shop>,
        ]
      : []),
    {
      title: '平台',
      dataIndex: 'platform',
      valueEnum: {
        WILDBERRIES: { text: PLATFORM_TEXT.WILDBERRIES },
        OZON: { text: PLATFORM_TEXT.OZON },
      },
    },
    {
      title: 'Token',
      dataIndex: 'hasToken',
      search: false,
      render: (_, row) =>
        row.hasToken ? <Tag color="green">已保存</Tag> : <Tag color="orange">未配置</Tag>,
    },
    {
      title: 'WB 品牌',
      search: false,
      ellipsis: true,
      render: (_, row) => shopWbBrand(row.extra) || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueEnum: {
        ENABLED: { text: SHOP_STATUS_TEXT.ENABLED, status: 'Success' },
        DISABLED: { text: SHOP_STATUS_TEXT.DISABLED, status: 'Error' },
        PLACEHOLDER: { text: SHOP_STATUS_TEXT.PLACEHOLDER, status: 'Warning' },
      },
    },
    { title: '更新时间', dataIndex: 'updatedAt', valueType: 'dateTime', search: false },
    {
      title: '操作',
      valueType: 'option',
      hideInTable: !hasPermission('shop:update') && !hasPermission('shop:disable'),
      render: (_, row) => [
        hasPermission('shop:update') ? (
          <ModalForm
            key="edit"
            title="编辑店铺"
            trigger={<a>编辑</a>}
            initialValues={{ name: row.name, wbBrand: shopWbBrand(row.extra) }}
            onFinish={async (values) => {
              await updateShop(row.id, values as { name: string; apiToken?: string; wbBrand?: string });
              message.success('已保存');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="店铺名称" rules={[{ required: true }]} />
            <ProFormText
              name="wbBrand"
              label="WB 品牌"
              extra="优先提交此品牌。未填时用采集品牌或 NoName，是否通过由 WB 判定。"
            />
            <ProFormText.Password
              name="apiToken"
              label="API Token"
              extra="留空则不改动已保存的 Token。接口永不回传明文。"
            />
          </ModalForm>
        ) : null,
        hasPermission('shop:disable') ? (
          row.status === 'ENABLED' ? (
            <Popconfirm
              key="disable"
              title="停用后无法用该店铺上下架，确认停用？"
              onConfirm={async () => {
                await changeShopStatus(row.id, 'DISABLED');
                message.success('已停用');
                actionRef.current?.reload();
              }}
            >
              <a>停用</a>
            </Popconfirm>
          ) : (
            <a
              key="enable"
              onClick={async () => {
                try {
                  await changeShopStatus(row.id, 'ENABLED');
                  message.success('已启用');
                  actionRef.current?.reload();
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '启用失败');
                }
              }}
            >
              启用
            </a>
          )
        ) : null,
      ],
    },
  ];

  return (
    <PageContainer>
      <Typography.Paragraph type="secondary">
        {isSuperAdmin
          ? '店铺额度由超级管理员按租户开通。新建时必须指定归属租户，租户管理员不能自行增改或换绑 Token，避免只买一个额度后擅自改成别的店。'
          : '店铺由平台超级管理员按租户开通。本页仅可查看已分配店铺；如需新增、改 Token 或换绑，请联系超级管理员。'}
      </Typography.Paragraph>
      <ProTable<Shop>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="店铺列表"
        request={async (params) => {
          const data = await fetchShops({
            current: params.current,
            pageSize: params.pageSize,
            keyword: params.name,
            platform: params.platform as Shop['platform'] | undefined,
            tenantId: isSuperAdmin ? (params.tenantId as string | undefined) : undefined,
            allTenants: isSuperAdmin,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() =>
          hasPermission('shop:create')
            ? [
                <ModalForm
                  key="create"
                  title="为租户开通店铺"
                  trigger={<Button type="primary">开通店铺</Button>}
                  onFinish={async (values) => {
                    await createShop(
                      values as {
                        tenantId: string;
                        name: string;
                        platform: Shop['platform'];
                        apiToken?: string;
                        wbBrand?: string;
                      },
                    );
                    message.success('已为该租户开通店铺');
                    actionRef.current?.reload();
                    return true;
                  }}
                >
                  <ProFormSelect
                    name="tenantId"
                    label="归属租户"
                    options={tenantOptions}
                    rules={[{ required: true, message: '请选择要开通店铺的租户' }]}
                    extra="店铺计入该租户的额度，开通后租户不能自行改绑。"
                  />
                  <ProFormSelect
                    name="platform"
                    label="平台"
                    options={[
                      { label: PLATFORM_TEXT.WILDBERRIES, value: 'WILDBERRIES' },
                      { label: PLATFORM_TEXT.OZON, value: 'OZON' },
                    ]}
                    rules={[{ required: true }]}
                    initialValue="WILDBERRIES"
                  />
                  <ProFormText name="name" label="店铺名称" rules={[{ required: true }]} />
                  <ProFormText
                    name="wbBrand"
                    label="WB 品牌"
                    extra="优先提交此品牌。未填时用采集品牌或 NoName，是否通过由 WB 判定。"
                  />
                  <ProFormText.Password
                    name="apiToken"
                    label="API Token"
                    extra="可稍后在编辑中补充。上架前必须保存 Token。"
                  />
                </ModalForm>,
              ]
            : []
        }
      />
    </PageContainer>
  );
}
