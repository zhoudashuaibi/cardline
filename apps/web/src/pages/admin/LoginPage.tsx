import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntApp, Button, Form, Input } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';

import { errorMessage } from '../../api/client';
import type { LoginRequest } from '../../api/types';
import BrandMark from '../../components/BrandMark';
import { useAuth } from '../../hooks/useAuth';

/**
 * 后台登录页。
 */
export default function LoginPage() {
  const { message } = AntApp.useApp();
  const { login, token, ready } = useAuth();
  const navigate = useNavigate();

  const [form] = Form.useForm<LoginRequest>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready && token) navigate('/admin/accounts', { replace: true });
  }, [navigate, ready, token]);

  const handleSubmit = async () => {
    let values: LoginRequest;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setLoading(true);
    try {
      await login(values);
      void message.success('登录成功');
      navigate('/admin/accounts', { replace: true });
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__head">
          <BrandMark size={46} />
          <h1 className="auth-card__title">管理后台登录</h1>
        </div>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ username: 'admin', password: '' }}
          onFinish={() => {
            void handleSubmit();
          }}
        >
          <Form.Item
            name="username"
            label="账号"
            rules={[{ required: true, message: '请输入管理员账号' }]}
          >
            <Input
              size="large"
              autoComplete="username"
              prefix={<UserOutlined style={{ color: '#98A5A0' }} />}
              placeholder="admin"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              size="large"
              autoComplete="current-password"
              prefix={<LockOutlined style={{ color: '#98A5A0' }} />}
              placeholder="请输入密码"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Button type="primary" size="large" block loading={loading} htmlType="submit">
              登录
            </Button>
          </Form.Item>
        </Form>

        <p className="auth-card__hint">默认账号 admin / admin123</p>
      </div>
    </div>
  );
}
