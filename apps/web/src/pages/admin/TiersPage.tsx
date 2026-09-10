import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import { createCreditTier, deleteCreditTier, errorMessage, listAccounts, listCreditTiers } from '../../api/client';
import type { CreditTier, CreateCreditTierRequest } from '../../api/types';
import { formatCredits, formatNumber } from '../../utils/format';

interface TierRow extends CreditTier {
  /** 该档位下的账号总数；null 表示尚未取得 */
  accountCount: number | null;
}

interface TierFormValues {
  credits: number;
  label?: string;
}

/**
 * 后台 · 额度档位管理。
 */
export default function TiersPage() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counting, setCounting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<TierFormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listCreditTiers();
      setRows(items.map((item) => ({ ...item, accountCount: null })));
      setLoading(false);

      if (items.length === 0) return;

      setCounting(true);
      const counts = await Promise.all(
        items.map(async (item) => {
          try {
            const response = await listAccounts({ credits: [item.credits], pageSize: 1, page: 1 });
            return response.total ?? 0;
          } catch {
            return null;
          }
        }),
      );
      setRows(items.map((item, index) => ({ ...item, accountCount: counts[index] ?? null })));
    } catch (error) {
      void message.error(errorMessage(error));
      setRows([]);
      setLoading(false);
    } finally {
      setCounting(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAccounts = useMemo(
    () => rows.reduce((sum, item) => sum + (item.accountCount ?? 0), 0),
    [rows],
  );

  const handleCreate = async () => {
    let values: TierFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload: CreateCreditTierRequest = {
      credits: values.credits,
      label: values.label?.trim() || `${values.credits} 额度`,
    };

    setCreating(true);
    try {
      await createCreditTier(payload);
      void message.success('档位已新增');
      setModalOpen(false);
      form.resetFields();
      await load();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCreditTier(id);
      void message.success('档位已删除');
      await load();
    } catch (error) {
      void message.error(errorMessage(error));
    }
  };

  const columns: ColumnsType<TierRow> = [
    {
      title: '额度',
      dataIndex: 'credits',
      key: 'credits',
      width: 140,
      render: (value: number) => <Tag color="green">{formatCredits(value)}</Tag>,
    },
    { title: '标签', dataIndex: 'label', key: 'label' },
    {
      title: '排序',
      dataIndex: 'sort',
      key: 'sort',
      width: 90,
      render: (value: number) => formatNumber(value),
    },
    {
      title: '账号数量',
      key: 'accountCount',
      width: 140,
      render: (_, record) =>
        record.accountCount === null ? (
          <span style={{ color: '#98A5A0' }}>统计中…</span>
        ) : (
          formatNumber(record.accountCount)
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      fixed: 'right',
      render: (_, record) => (
        <Popconfirm
          title="删除该档位？"
          description="仅删除档位配置，不会影响已有账号。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            void handleDelete(record.id);
          }}
        >
          <Button type="link" size="small" danger>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <div className="admin-toolbar">
        <Space wrap>
          <span style={{ fontSize: 13, color: '#6B7A74' }}>
            共 {rows.length} 个档位 · 账号合计 {formatNumber(totalAccounts)}
            {counting ? ' · 统计中…' : ''}
          </span>
        </Space>
        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void load();
            }}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setModalOpen(true);
            }}
          >
            新增档位
          </Button>
        </Space>
      </div>

      <div className="admin-card">
        <Table<TierRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 720 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无额度档位" />,
          }}
        />
      </div>

      <Modal
        title="新增档位"
        open={modalOpen}
        confirmLoading={creating}
        okText="保存"
        cancelText="取消"
        onOk={() => {
          void handleCreate();
        }}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} style={{ marginTop: 12 }}>
          <Form.Item
            name="credits"
            label="额度"
            rules={[{ required: true, message: '请输入额度' }]}
          >
            <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="例如 300" />
          </Form.Item>
          <Form.Item name="label" label="标签">
            <Input placeholder="留空则自动生成，例如「300 额度」" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
