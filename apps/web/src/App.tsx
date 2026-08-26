import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { BasicLayout } from './layouts/BasicLayout';
import LoginPage from './pages/login';
import DashboardPage from './pages/dashboard';
import TenantPage from './pages/iam/tenants';
import RolePage from './pages/iam/roles';
import UserPage from './pages/iam/users';
import ShopPage from './pages/iam/shops';
import CrawlerTaskPage from './pages/crawler/tasks';
import ProductReviewPage from './pages/product/review';
import ProductCatalogPage from './pages/product/catalog';
import OrderPage from './pages/order';
import WarehousePage from './pages/warehouse';
import TracePage from './pages/trace';

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function RequirePermission({ code, children }: { code: string; children: React.ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(code)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user && !loading ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<BasicLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/iam/tenants" element={<RequirePermission code="menu:tenant"><TenantPage /></RequirePermission>} />
            <Route path="/iam/roles" element={<RequirePermission code="menu:role"><RolePage /></RequirePermission>} />
            <Route path="/iam/users" element={<RequirePermission code="menu:user"><UserPage /></RequirePermission>} />
            <Route path="/iam/shops" element={<RequirePermission code="menu:shop"><ShopPage /></RequirePermission>} />
            <Route path="/crawler/tasks" element={<RequirePermission code="menu:crawler"><CrawlerTaskPage /></RequirePermission>} />
            <Route path="/product/review" element={<RequirePermission code="menu:product-review"><ProductReviewPage /></RequirePermission>} />
            <Route path="/product/catalog" element={<RequirePermission code="menu:product"><ProductCatalogPage /></RequirePermission>} />
            <Route path="/order" element={<RequirePermission code="menu:order"><OrderPage /></RequirePermission>} />
            <Route path="/warehouse" element={<RequirePermission code="menu:warehouse"><WarehousePage /></RequirePermission>} />
            <Route path="/trace" element={<RequirePermission code="menu:trace"><TracePage /></RequirePermission>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
