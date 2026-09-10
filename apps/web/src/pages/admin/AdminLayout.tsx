import { useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App as AntApp, Dropdown, Form, Input, Layout, Menu, Modal, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  DownOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { changePassword, errorMessage } from '../../api/client';
import BrandMark from '../../components/BrandMark';
import { useAuth } from '../../hooks/useAuth';

const { Content, Header, Sider } = Layout;

const PAGE_TITLES: Record<string, string> = {
  '/admin/dashboard': '数据概览',
  '/admin/accounts': '账号列表',
  '/admin/cards': '卡密管理',
  '/admin/tiers': '额度档位',
  '/admin/settings': '系统设置',
};

const MENU_ITEMS: MenuProps['items'] = [
  { key: '/admin/dashboard', icon: <DashboardOutlined />, label: '数据概览' },
  { key: '/admin/accounts', icon: <TeamOutlined />, label: '账号列表' },
  { key: '/admin/cards', icon: <KeyOutlined />, label: '卡密管理' },
  { key: '/admin/tiers', icon: <TagsOutlined />, label: '额度档位' },
  { key: '/admin/settings', icon: <SettingOutlined />, label: '系统设置' },
];

interface PasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * 后台外壳：深色侧边栏 + 白色头部 + 内容区。
 *
 * 未登录时重定向到 `/admin/login`；任意接口 401 会由 `useAuth` 清理登录态。
 */
export default function AdminLayout() {
  const { message } = AntApp.useApp();
  const { token, user, ready, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PasswordFormValues>();

  const currentPath = useMemo(() => {
    const match = Object.keys(PAGE_TITLES).find((path) => location.pathname.startsWith(path));
    return match ?? '/admin/accounts';
  }, [location.pathname]);

  const displayName = user?.displayName || user?.username || 'admin';

  if (!ready) {
    return (
      <div className="auth-page">
        <Spin size="large" />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    navigate(key);
  };

  const handleUserMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'password') {
      setPasswordOpen(true);
      return;
    }
    if (key === 'logout') {
      logout();
      void message.success('已退出登录');
      navigate('/admin/login', { replace: true });
    }
  };

  const submitPassword = async () => {
    let values: PasswordFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      await changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      void message.success('密码已更新');
      setPasswordOpen(false);
      form.resetFields();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout className="admin-shell">
      <Sider
        className="admin-sider"
        theme="dark"
        collapsible
        collapsed={collapsed}
        width={216}
        collapsedWidth={64}
        onCollapse={setCollapsed}
      >
        <div className="admin-sider__brand">
          <BrandMark size={30} showText={!collapsed} tone="dark" />
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={MENU_ITEMS}
          selectedKeys={[currentPath]}
          onClick={handleMenuClick}
        />
      </Sider>

      <Layout style={{ background: 'transparent' }}>
        <Header
          className="admin-header"
          style={{
            height: 56,
            lineHeight: 1.4,
            padding: '0 24px',
            background: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span className="admin-header__title">{PAGE_TITLES[currentPath] ?? '管理后台'}</span>

          <Dropdown
            trigger={['click']}
            menu={{
              onClick: handleUserMenuClick,
              items: [
                { key: 'password', icon: <LockOutlined />, label: '修改密码' },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
              ],
            }}
          >
            <span className="admin-header__user">
              <UserOutlined />
              {displayName}
              <DownOutlined style={{ fontSize: 10, color: '#98A5A0' }} />
            </span>
          </Dropdown>
        </Header>

        <Content style={{ padding: '20px 24px 40px', background: 'transparent' }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal
        title="修改密码"
        open={passwordOpen}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        onOk={() => {
          void submitPassword();
        }}
        onCancel={() => {
          setPasswordOpen(false);
          form.resetFields();
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} style={{ marginTop: 12 }}>
          <Form.Item
            name="oldPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" placeholder="当前密码" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '新密码至少 6 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value: string) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="确认新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
