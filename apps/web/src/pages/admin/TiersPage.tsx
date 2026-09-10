import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Empty, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';

import { getCreditTiers, errorMessage, MAIL_CREDITS_PER_TIER } from '../../api/client';
import type { CreditTier } from '../../api/types';
import { formatCredits, formatNumber } from '../../utils/format';

/**
 * 后台 · 额度档位（只读）。
 *
 * 档位不是手工字典：账号导入后由「邮箱取件命中额度关键字」自动定档，
 * 档位 = 邮件命中 credits ÷ 25（0 = 待定档，不进兑换池）。
 * 这里只展示账号实际形成的档位分布。
 */
export default function TiersPage() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<CreditTier[]>([]);
  const [pending, setPending] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCreditTiers();
      setRows(Array.isArray(response?.items) ? response.items : []);
      setPending(response?.pending ?? 0);
      setTotal(response?.total ?? 0);
    } catch (error) {
      void message.error(errorMessage(error));
      setRows([]);
      setPending(0);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<CreditTier> = [
    {
      title: '档位',
      dataIndex: 'credits',
      key: 'credits',
      width: 140,
      render: (value: number) =>
        value > 0 ? (
          <Tag color="green">{formatCredits(value)}</Tag>
        ) : (
          <Tag color="orange">待定档</Tag>
        ),
    },
    {
      title: '来源',
      key: 'source',
      width: 220,
      render: (_, record) =>
        record.credits > 0 ? (
          <span style={{ color: '#6B7A74' }}>
            邮件取件命中 {record.credits * MAIL_CREDITS_PER_TIER} credits
          </span>
        ) : (
          <span style={{ color: '#6B7A74' }}>取件未命中额度关键字</span>
        ),
    },
    {
      title: '账号数',
      dataIndex: 'accounts',
      key: 'accounts',
      width: 110,
      render: (value: number) => formatNumber(value),
    },
    {
      title: '可售',
      dataIndex: 'available',
      key: 'available',
      width: 100,
      render: (value: number) => <b>{formatNumber(value)}</b>,
    },
    {
      title: '已兑换',
      dataIndex: 'redeemed',
      key: 'redeemed',
      width: 100,
      render: (value: number) => formatNumber(value),
    },
    {
      title: '已封禁',
      dataIndex: 'banned',
      key: 'banned',
      width: 100,
      render: (value: number) => formatNumber(value),
    },
    {
      title: '已停用',
      dataIndex: 'disabled',
      key: 'disabled',
      width: 100,
      render: (value: number) => formatNumber(value),
    },
  ];

  return (
    <>
      <div className="admin-toolbar">
        <Space wrap>
          <span style={{ fontSize: 13, color: '#6B7A74' }}>
            共 {rows.filter((item) => item.credits > 0).length} 个档位 · 账号合计{' '}
            {formatNumber(total)}
            {pending > 0 ? ` · 待定档 ${formatNumber(pending)}` : ''}
          </span>
          <Tooltip title="档位由账号邮箱取件命中额度关键字自动得出（档位 = 命中 credits ÷ 25），无法手工新增或删除。取件未命中的账号为「待定档」，不进兑换池。">
            <InfoCircleOutlined style={{ color: '#98A5A0' }} />
          </Tooltip>
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
        </Space>
      </div>

      <div className="admin-card">
        <Table<CreditTier>
          rowKey="credits"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 820 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有定档的账号：导入后等待邮箱取件命中额度"
              />
            ),
          }}
        />
      </div>
    </>
  );
}
