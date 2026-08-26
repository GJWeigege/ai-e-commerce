import { PageContainer, ProTable, ModalForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import { Button, Popconfirm, Tag, message } from 'antd';
import { useRef } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { changeTenantStatus, createTenant, fetchTenants, Tenant, updateTenant } from '../../../services/tenant';

export default function TenantPage() {
  const actionRef = useRef<ActionType>();

  const columns: ProColumns<Tenant>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '编码', dataIndex: 'code' },
    {
      title: '状态',
      dataIndex: 'status',
      valueEnum: {
        ACTIVE: { text: '正常', status: 'Success' },
        SUSPENDED: { text: '停用', status: 'Warning' },
        CLOSED: { text: '关闭', status: 'Default' },
      },
      render: (_, row) => (
        <Tag color={row.status === 'ACTIVE' ? 'green' : 'orange'}>
          {row.status === 'ACTIVE' ? '正常' : row.status === 'SUSPENDED' ? '停用' : '关闭'}
        </Tag>
      ),
    },
    {
      title: '隔离模式',
      dataIndex: 'isolationMode',
      search: false,
      render: (_, row) => (row.isolationMode === 'SHARED' ? '共享库' : '独立库'),
    },
    { title: '备注', dataIndex: 'remark', search: false, ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', search: false },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => [
        <ModalForm
          key="edit"
          title="编辑租户"
          trigger={<a>编辑</a>}
          initialValues={row}
          onFinish={async (values) => {
            await updateTenant(row.id, values as { name: string; remark?: string });
            message.success('已保存');
            actionRef.current?.reload();
            return true;
          }}
        >
          <ProFormText name="name" label="名称" rules={[{ required: true }]} />
          <ProFormTextArea name="remark" label="备注" />
        </ModalForm>,
        row.status === 'ACTIVE' ? (
          <Popconfirm
            key="suspend"
            title="确认停用该租户？"
            onConfirm={async () => {
              await changeTenantStatus(row.id, 'SUSPENDED');
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
              await changeTenantStatus(row.id, 'ACTIVE');
              message.success('已启用');
              actionRef.current?.reload();
            }}
          >
            启用
          </a>
        ),
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<Tenant>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="租户列表"
        request={async (params) => {
          const data = await fetchTenants({
            current: params.current,
            pageSize: params.pageSize,
            keyword: params.name || params.keyword,
            status: params.status as string | undefined,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() => [
          <ModalForm
            key="create"
            title="新建租户"
            trigger={<Button type="primary">新建租户</Button>}
            onFinish={async (values) => {
              await createTenant(values as { name: string; code: string; remark?: string });
              message.success('创建成功');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormText name="name" label="名称" rules={[{ required: true }]} />
            <ProFormText
              name="code"
              label="编码"
              extra="创建后不可修改，仅字母数字和下划线"
              rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: '编码格式不正确' }]}
            />
            <ProFormTextArea name="remark" label="备注" />
          </ModalForm>,
        ]}
      />
    </PageContainer>
  );
}
