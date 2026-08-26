import { PageContainer, ProTable, ModalForm, ProFormText, ProFormSelect, ProFormCheckbox, ProFormDependency } from '@ant-design/pro-components';
import { Button, Popconfirm, Tag, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { OPERATOR_MODULE_OPTIONS } from '@aiecom/shared';
import { createUser, fetchRoles, fetchUsers, SysUser, updateUser } from '../../../services/user';
import { useAuth } from '../../../auth';
import { fetchTenantOptions, Tenant } from '../../../services/tenant';
import { Shop, fetchShops } from '../../../services/shop';

const MODULE_OPTIONS = OPERATOR_MODULE_OPTIONS.map((item) => ({ label: item.name, value: item.code }));

function isOperatorUser(row: SysUser) {
  return row.userRoles.some((item) => item.role.code === 'OPERATOR');
}

function isTenantAdminUser(row: SysUser) {
  return row.userRoles.some((item) => item.role.code === 'TENANT_ADMIN' || item.role.code === 'SUPER_ADMIN');
}

export default function UserPage() {
  const actionRef = useRef<ActionType>();
  const { user, hasPermission } = useAuth();
  const [roles, setRoles] = useState<Array<{ code: string; name: string }>>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const isSuperAdmin = user?.roles.includes('SUPER_ADMIN') ?? false;

  useEffect(() => {
    fetchRoles()
      .then(setRoles)
      .catch((error: Error) => message.error(error.message));
    fetchShops({ current: 1, pageSize: 200, allTenants: isSuperAdmin })
      .then((data) => setShops(data.list))
      .catch((error: Error) => message.error(error.message));
    if (isSuperAdmin) {
      fetchTenantOptions()
        .then(setTenants)
        .catch((error: Error) => message.error(error.message));
    }
  }, [isSuperAdmin]);

  const columns: ProColumns<SysUser>[] = [
    { title: '用户名', dataIndex: 'username' },
    { title: '姓名', dataIndex: 'realName' },
    ...(isSuperAdmin
      ? [
          {
            title: '租户',
            search: false,
            render: (_: unknown, row: SysUser) =>
              row.tenant ? `${row.tenant.name} (${row.tenant.code})` : '-',
          } as ProColumns<SysUser>,
        ]
      : []),
    { title: '角色', search: false, render: (_, row) => row.userRoles.map((item) => item.role.name).join('、') },
    {
      title: '可访问模块',
      search: false,
      ellipsis: true,
      render: (_, row) => {
        if (isTenantAdminUser(row)) {
          return <Tag>本租户全部模块</Tag>;
        }
        const names = (row.moduleAccesses || []).map((item) => item.permission.name);
        return names.length ? names.map((name) => <Tag key={name}>{name}</Tag>) : <Tag>仅工作台</Tag>;
      },
    },
    {
      title: '可操作店铺',
      search: false,
      ellipsis: true,
      render: (_, row) => {
        if (isTenantAdminUser(row)) {
          return <Tag>本租户全部店铺</Tag>;
        }
        const names = (row.shopAccesses || []).map((item) => item.shop.name);
        return names.length ? names.map((name) => <Tag key={name}>{name}</Tag>) : <Tag color="orange">未分配</Tag>;
      },
    },
    { title: '邮箱', dataIndex: 'email', search: false },
    {
      title: '状态',
      dataIndex: 'status',
      valueEnum: {
        ACTIVE: { text: '正常', status: 'Success' },
        DISABLED: { text: '停用', status: 'Error' },
      },
    },
    { title: '最近登录', dataIndex: 'lastLoginAt', valueType: 'dateTime', search: false },
    {
      title: '操作',
      valueType: 'option',
      hideInTable: !hasPermission('user:update'),
      render: (_, row) => [
        isOperatorUser(row) ? (
          <ModalForm
            key="perm"
            title="分配权限"
            trigger={<a>权限</a>}
            initialValues={{
              moduleCodes: (row.moduleAccesses || []).map((item) => item.permission.code),
              shopIds: (row.shopAccesses || []).map((item) => item.shopId),
            }}
            onFinish={async (values) => {
              await updateUser(row.id, {
                moduleCodes: (values.moduleCodes as string[]) || [],
                shopIds: (values.shopIds as string[]) || [],
              });
              message.success('已保存权限');
              actionRef.current?.reload();
              return true;
            }}
          >
            <ProFormCheckbox.Group
              name="moduleCodes"
              label="可访问模块"
              options={MODULE_OPTIONS}
              extra="未勾选时登录后仅能看到工作台。商品库会附带店铺只读列表，用于上下架。"
            />
            <ProFormSelect
              name="shopIds"
              label="可操作店铺"
              mode="multiple"
              options={shops
                .filter((item) => !row.tenantId || item.tenantId === row.tenantId)
                .map((item) => ({
                  label: `${item.name}（${item.platform}）`,
                  value: item.id,
                }))}
              extra="操作员只能上下架这里勾选的店铺。"
            />
          </ModalForm>
        ) : null,
        row.status === 'ACTIVE' ? (
          <Popconfirm
            key="disable"
            title="确认停用该用户？"
            onConfirm={async () => {
              await updateUser(row.id, { status: 'DISABLED' });
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
              await updateUser(row.id, { status: 'ACTIVE' });
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
      <ProTable<SysUser>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="用户列表"
        request={async (params) => {
          const data = await fetchUsers({
            current: params.current,
            pageSize: params.pageSize,
            keyword: params.username,
            status: params.status as string | undefined,
          });
          return { data: data.list, total: data.total, success: true };
        }}
        toolBarRender={() =>
          hasPermission('user:create')
            ? [
                <ModalForm
                  key="create"
                  title="新建用户"
                  trigger={<Button type="primary">新建用户</Button>}
                  onFinish={async (values) => {
                    await createUser(values as Parameters<typeof createUser>[0]);
                    message.success('创建成功');
                    actionRef.current?.reload();
                    return true;
                  }}
                >
                  {isSuperAdmin ? (
                    <ProFormSelect
                      name="tenantId"
                      label="所属租户"
                      options={tenants.map((item) => ({ label: `${item.name} (${item.code})`, value: item.id }))}
                      rules={[{ required: true, message: '请选择租户' }]}
                    />
                  ) : null}
                  <ProFormText name="username" label="用户名" rules={[{ required: true }]} />
                  <ProFormText.Password name="password" label="密码" rules={[{ required: true, min: 8 }]} />
                  <ProFormText name="realName" label="姓名" />
                  <ProFormSelect
                    name="roleCode"
                    label="角色"
                    options={roles.map((item) => ({ label: item.name, value: item.code }))}
                    rules={[{ required: true }]}
                  />
                  <ProFormDependency name={['roleCode', 'tenantId']}>
                    {({ roleCode, tenantId }) => {
                      if (roleCode !== 'OPERATOR') {
                        return null;
                      }
                      const shopOptions = shops
                        .filter((item) => !isSuperAdmin || !tenantId || item.tenantId === tenantId)
                        .map((item) => ({
                          label: `${item.name}（${item.platform}）`,
                          value: item.id,
                        }));
                      return (
                        <>
                          <ProFormCheckbox.Group
                            name="moduleCodes"
                            label="可访问模块"
                            options={MODULE_OPTIONS}
                            extra="未勾选时操作员登录后仅能看到工作台。"
                          />
                          <ProFormSelect
                            name="shopIds"
                            label="可操作店铺"
                            mode="multiple"
                            options={shopOptions}
                            extra="操作员必须分配店铺后才能上下架。"
                          />
                        </>
                      );
                    }}
                  </ProFormDependency>
                </ModalForm>,
              ]
            : []
        }
      />
    </PageContainer>
  );
}
