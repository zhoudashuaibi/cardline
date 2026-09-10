import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';

import { changePassword, errorMessage, getSettings, updateSettings } from '../../api/client';
import type { DeliverFormat, Settings } from '../../api/types';

const { TextArea } = Input;

const FORMAT_OPTIONS: Array<{ value: DeliverFormat; label: string }> = [
  { value: 'sub2api', label: 'sub2api' },
  { value: 'cpa', label: 'CPA' },
  { value: 'email', label: '邮箱 TXT' },
];

interface PasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * 后台 · 系统设置。
 */
export default function SettingsPage() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<Settings>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      form.setFieldsValue(data);
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [form, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    let values: Settings;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      const updated = await updateSettings({
        siteName: values.siteName,
        siteSubtitle: values.siteSubtitle,
        pickupConcurrency: values.pickupConcurrency,
        pickupMaxMessages: values.pickupMaxMessages,
        defaultFormat: values.defaultFormat,
        redeemLimitPerCard: values.redeemLimitPerCard,
        announcement: values.announcement ?? '',
      });
      form.setFieldsValue(updated);
      void message.success('设置已保存');
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    let values: PasswordFormValues;
    try {
      values = await passwordForm.validateFields();
    } catch {
      return;
    }

    setChanging(true);
    try {
      await changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      void message.success('密码已更新');
      passwordForm.resetFields();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setChanging(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card
          size="small"
          title="站点设置"
          extra={
            <Button type="link" size="small" onClick={() => void load()}>
              重新加载
            </Button>
          }
        >
          <Spin spinning={loading}>
            <Form
              form={form}
              layout="vertical"
              initialValues={{
                siteName: 'Cardline',
                siteSubtitle: 'SECURE DELIVERY',
                pickupConcurrency: 4,
                pickupMaxMessages: 30,
                defaultFormat: 'sub2api',
                redeemLimitPerCard: 1,
                announcement: '',
              }}
            >
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="siteName"
                    label="站点名称"
                    rules={[{ required: true, message: '请输入站点名称' }]}
                  >
                    <Input placeholder="Cardline" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="siteSubtitle" label="站点副标题">
                    <Input placeholder="SECURE DELIVERY" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item name="pickupConcurrency" label="取件并发">
                    <InputNumber style={{ width: '100%' }} min={1} max={20} precision={0} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="pickupMaxMessages" label="单账号取件邮件数">
                    <InputNumber style={{ width: '100%' }} min={1} max={50} precision={0} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="redeemLimitPerCard" label="每卡兑换上限">
                    <InputNumber style={{ width: '100%' }} min={1} max={20} precision={0} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="defaultFormat" label="默认交付格式">
                <Select options={FORMAT_OPTIONS} />
              </Form.Item>

              <Form.Item name="announcement" label="公告">
                <TextArea rows={3} placeholder="展示在前台的公告内容，可留空" />
              </Form.Item>

              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  保存设置
                </Button>
                <Button onClick={() => void load()}>重置</Button>
              </Space>
            </Form>
          </Spin>
        </Card>
      </Col>

      <Col xs={24} xl={10}>
        <Card size="small" title="修改密码">
          <Form form={passwordForm} layout="vertical" requiredMark={false}>
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

            <Button
              type="primary"
              loading={changing}
              onClick={() => {
                void handleChangePassword();
              }}
            >
              更新密码
            </Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}
