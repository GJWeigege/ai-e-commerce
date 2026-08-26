import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Tag } from 'antd';
import type { ProColumns } from '@ant-design/pro-components';
import { fetchRoleCatalog, RoleCatalogItem } from '../../../services/user';

export default function RolePage() {
  const columns: ProColumns<RoleCatalogItem>[] = [
    { title: '角色', dataIndex: 'name', search: false },
    { title: '编码', dataIndex: 'code', search: false },
    {
      title: '类型',
      search: false,
      render: (_, row) => <Tag>{row.isSystem ? '系统角色' : '自定义'}</Tag>,
    },
    {
      title: '菜单权限',
      search: false,
      render: (_, row) =>
        row.permissions
          .filter((item) => item.type === 'MENU')
          .map((item) => <Tag key={item.code}>{item.name}</Tag>),
    },
    {
      title: '权限点数',
      search: false,
      render: (_, row) => row.permissions.length,
    },
  ];

  return (
    <PageContainer>
      <ProTable<RoleCatalogItem>
        rowKey="id"
        columns={columns}
        headerTitle="系统角色"
        search={false}
        pagination={false}
        request={async () => {
          const list = await fetchRoleCatalog();
          return { data: list, total: list.length, success: true };
        }}
        expandable={{
          expandedRowRender: (row) =>
            row.permissions.map((item) => (
              <Tag key={item.code} style={{ marginBottom: 8 }}>
                {item.name}（{item.code}）
              </Tag>
            )),
        }}
      />
    </PageContainer>
  );
}
