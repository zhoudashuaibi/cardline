import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Button, Result } from 'antd';

import SiteFooter from './components/SiteFooter';
import SiteHeader from './components/SiteHeader';
import PickupPage from './pages/PickupPage';
import RedeemPage from './pages/RedeemPage';
import AccountsPage from './pages/admin/AccountsPage';
import AdminLayout from './pages/admin/AdminLayout';
import CardsPage from './pages/admin/CardsPage';
import DashboardPage from './pages/admin/DashboardPage';
import LoginPage from './pages/admin/LoginPage';
import SettingsPage from './pages/admin/SettingsPage';
import TiersPage from './pages/admin/TiersPage';

function NotFoundPage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="page__body">
        <div className="shell" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <Result
            status="404"
            title="404"
            subTitle="页面不存在或已被移除。"
            extra={
              <Link to="/">
                <Button type="primary">返回卡密兑换</Button>
              </Link>
            }
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * 路由表：公共站点 + 后台控制台共用一个 Vite 应用。
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedeemPage />} />
      <Route path="/pickup" element={<PickupPage />} />

      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/accounts" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="cards" element={<CardsPage />} />
        <Route path="tiers" element={<TiersPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
