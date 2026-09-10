import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Card, Col, Empty, Row, Spin, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { errorMessage, getOverview } from '../../api/client';
import type { OverviewBatch, OverviewCreditsRow, OverviewResponse, RedeemTrendPoint } from '../../api/types';
import { formatCredits, formatDateTime, formatNumber } from '../../utils/format';

const MAX_BAR_HEIGHT = 130;

const CREDITS_COLUMNS: ColumnsType<OverviewCreditsRow> = [
  {
    title: '额度',
    dataIndex: 'credits',
    key: 'credits',
    render: (value: number) => <Tag color="green">{formatCredits(value)}</Tag>,
  },
  { title: '总数', dataIndex: 'total', key: 'total', render: (value: number) => formatNumber(value) },
  {
    title: '未兑换',
    dataIndex: 'unredeemed',
    key: 'unredeemed',
    render: (value: number) => formatNumber(value),
  },
  {
    title: '已兑换',
    dataIndex: 'redeemed',
    key: 'redeemed',
    render: (value: number) => formatNumber(value),
  },
  {
    title: '已封禁',
    dataIndex: 'banned',
    key: 'banned',
    render: (value: number) => <span style={{ color: value > 0 ? '#D9534F' : undefined }}>{formatNumber(value)}</span>,
  },
];

const BATCH_COLUMNS: ColumnsType<OverviewBatch> = [
  {
    title: '批次号',
    dataIndex: 'batchId',
    key: 'batchId',
    render: (value: string) => <span className="mono">{value}</span>,
  },
  {
    title: '额度',
    dataIndex: 'credits',
    key: 'credits',
    render: (value: number) => formatCredits(value),
  },
  {
    title: '数量',
    dataIndex: 'count',
    key: 'count',
    render: (value: number) => formatNumber(value),
  },
  {
    title: '备注',
    dataIndex: 'remark',
    key: 'remark',
    render: (value: string | null) => value || <span style={{ color: '#98A5A0' }}>—</span>,
  },
  {
    title: '导入时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: (value: string) => formatDateTime(value),
  },
];

/**
 * 后台首页 · 数据概览。
 */
export default function DashboardPage() {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getOverview());
    } catch (error) {
      void message.error(errorMessage(error));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const trend: RedeemTrendPoint[] = data?.redeemTrend ?? [];
  const maxCount = useMemo(
    () => Math.max(1, ...trend.map((point) => point.count)),
    [trend],
  );

  const accounts = data?.accounts;

  const stats = [
    { key: 'total', title: '账号总数', value: accounts?.total ?? 0 },
    { key: 'unredeemed', title: '未兑换', value: accounts?.unredeemed ?? 0 },
    { key: 'redeemed', title: '已兑换', value: accounts?.redeemed ?? 0 },
    { key: 'banned', title: '已封禁', value: accounts?.banned ?? 0 },
    { key: 'invalid', title: '凭据失效', value: accounts?.invalid ?? 0 },
  ];

  return (
    <Spin spinning={loading}>
      <Row gutter={[16, 16]}>
        {stats.map((item) => (
          <Col key={item.key} flex="1 1 180px">
            <Card size="small">
              <Statistic title={item.title} value={item.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card size="small" title="按额度分布">
            <Table<OverviewCreditsRow>
              rowKey="credits"
              size="small"
              columns={CREDITS_COLUMNS}
              dataSource={data?.byCredits ?? []}
              pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card size="small" title="卡密概览">
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="卡密总数" value={data?.cards.total ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="已兑换" value={data?.cards.redeemed ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="未兑换" value={data?.cards.unredeemed ?? 0} />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="近 14 天兑换趋势" style={{ marginTop: 16 }}>
        {trend.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无兑换记录" />
        ) : (
          <div className="trend cardline-scroll">
            {trend.map((point) => {
              const height = Math.max(3, Math.round((point.count / maxCount) * MAX_BAR_HEIGHT));
              return (
                <div className="trend__col" key={point.date}>
                  <span className="trend__count">{point.count}</span>
                  <div
                    className={`trend__bar${point.count === 0 ? ' trend__bar--zero' : ''}`}
                    style={{ height }}
                  />
                  <span className="trend__date">{point.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card size="small" title="导入批次" style={{ marginTop: 16 }}>
        <Table<OverviewBatch>
          rowKey="batchId"
          size="small"
          columns={BATCH_COLUMNS}
          dataSource={data?.batches ?? []}
          pagination={false}
          scroll={{ x: 720 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次" /> }}
        />
      </Card>
    </Spin>
  );
}
