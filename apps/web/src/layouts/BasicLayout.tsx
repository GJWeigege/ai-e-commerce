import { LogoutOutlined, ShopOutlined } from '@ant-design/icons';
import { ProLayout } from '@ant-design/pro-components';
import type { MenuDataItem } from '@ant-design/pro-components';
import { Dropdown, Select, message } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { fetchTenantOptions, Tenant } from '../services/tenant';
import { getWorkingTenantId, setWorkingTenantId } from '../services/request';

type AppMenu = {
  path: string;
  name: string;
  icon?: ReactNode;
  permission: string;
};

const ALL_MENUS: AppMenu[] = [
  { path: '/dashboard', name: '工作台', permission: 'menu:dashboard' },
  { path: '/iam/tenants', name: '租户管理', permission: 'menu:tenant' },
  { path: '/iam/roles', name: '角色权限', permission: 'menu:role' },
  { path: '/iam/users', name: '用户管理', permission: 'menu:user' },
  { path: '/iam/shops', name: '店铺管理', permission: 'menu:shop', icon: <ShopOutlined /> },
  { path: '/crawler/tasks', name: '采集任务', permission: 'menu:crawler' },
  { path: '/product/review', name: '选品复审', permission: 'menu:product-review' },
  { path: '/product/catalog', name: '商品库', permission: 'menu:product' },
  { path: '/order', name: '订单中心', permission: 'menu:order' },
  { path: '/warehouse', name: '仓储履约', permission: 'menu:warehouse' },
  { path: '/trace', name: '全链路追踪', permission: 'menu:trace' },
];

/** ProLayout 会按路径前缀把 /iam/* 收成无名父级，导致子菜单从侧栏消失 */
function hoistUnnamedMenus(items: MenuDataItem[] = []): MenuDataItem[] {
  return items.flatMap((item) => {
    const children = hoistUnnamedMenus(item.children || item.routes || []);
    if (!item.name) {
      return children;
    }
    return [{ ...item, children: children.length ? children : undefined, routes: undefined }];
  });
}

export function BasicLayout() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(getWorkingTenantId());
  const isSuperAdmin = user?.roles.includes('SUPER_ADMIN') ?? false;

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchTenantOptions()
      .then(setTenants)
      .catch((error: Error) => message.error(error.message));
  }, [isSuperAdmin]);

  const menuData = ALL_MENUS.filter((item) => hasPermission(item.permission));

  return (
    <ProLayout
      title="跨境电商系统"
      layout="side"
      location={{ pathname: location.pathname }}
      menu={{ locale: false, defaultOpenAll: true }}
      menuDataRender={() =>
        hoistUnnamedMenus(
          menuData.map((item) => ({
            path: item.path,
            name: item.name,
            icon: item.icon,
            hideInMenu: false,
          })),
        )
      }
      avatarProps={{
        src: undefined,
        title: user?.realName || user?.username,
        render: (_props, dom) => (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => {
                    logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            {dom}
          </Dropdown>
        ),
      }}
      actionsRender={() =>
        isSuperAdmin
          ? [
              <Select
                key="tenant"
                placeholder="选择工作租户"
                style={{ width: 220 }}
                value={tenantId}
                options={tenants.map((item) => ({ label: `${item.name} (${item.code})`, value: item.id }))}
                onChange={(value) => {
                  setWorkingTenantId(value);
                  setTenantId(value);
                  message.success('已切换工作租户');
                  navigate(0);
                }}
                allowClear
                onClear={() => {
                  setWorkingTenantId(null);
                  setTenantId(null);
                }}
              />,
            ]
          : []
      }
      menuItemRender={(item, dom) => <Link to={item.path || '/'}>{dom}</Link>}
      route={{
        path: '/',
        routes: menuData,
      }}
    >
      <Outlet />
    </ProLayout>
  );
}
