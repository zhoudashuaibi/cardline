import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';

import {
  DEFAULT_CREDIT_TIERS,
  batchDisableCards,
  downloadBlob,
  errorMessage,
  exportAccountsBlob,
  listCards,
  listCreditTiers,
  updateCard,
} from '../../api/client';
import type { CardRow, CardStatus, DeliverFormat } from '../../api/types';
import CopyButton from '../../components/CopyButton';
import { CARD_STATUS_META, CARD_STATUS_OPTIONS, formatCredits, formatDateTime } from '../../utils/format';

const EXPORT_ITEMS = [
  { key: 'sub2api', label: 'sub2api' },
  { key: 'cpa', label: 'CPA' },
  { key: 'email', label: '邮箱TXT' },
];

/**
 * 后台 · 卡密管理。
 */
export default function CardsPage() {
  const { message } = AntApp.useApp();

  const [rows, setRows] = useState<CardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [creditOptions, setCreditOptions] = useState<number[]>(DEFAULT_CREDIT_TIERS);
  const [credits, setCredits] = useState<number[]>([]);
  const [status, setStatus] = useState<CardStatus[]>([]);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCreditTiers()
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setCreditOptions(items.map((item) => item.credits));
      })
      .catch(() => {
        /* 档位接口不可用时使用契约默认档位 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listCards({
        page,
        pageSize,
        keyword: keyword || undefined,
        credits: credits.length > 0 ? credits : undefined,
        status: status.length > 0 ? status : undefined,
      });
      setRows(response.items ?? []);
      setTotal(response.total ?? 0);
    } catch (error) {
      void message.error(errorMessage(error));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [credits, keyword, message, page, pageSize, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const creditSelectOptions = useMemo(
    () => creditOptions.map((item) => ({ value: item, label: formatCredits(item) })),
    [creditOptions],
  );

  const handleToggle = async (record: CardRow, nextActive: boolean) => {
    setBusyId(record.id);
    try {
      await updateCard(record.id, { status: nextActive ? 'active' : 'disabled' });
      void message.success(nextActive ? '卡密已启用' : '卡密已停用');
      await load();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const handleBatchDisable = async () => {
    if (selectedIds.length === 0) return;
    setDisabling(true);
    try {
      const response = await batchDisableCards(selectedIds);
      void message.success(`已停用 ${response.updated ?? 0} 张卡密`);
      setSelectedIds([]);
      await load();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setDisabling(false);
    }
  };

  const handleExport = async (format: DeliverFormat) => {
    try {
      const { blob, filename } = await exportAccountsBlob({
        format,
        filter: {
          credits: credits.length > 0 ? credits : undefined,
          keyword: keyword || undefined,
        },
        includeCardKey: true,
        filename: `cards-${format}`,
      });
      downloadBlob(blob, filename);
      void message.success('导出已开始');
    } catch (error) {
      void message.error(errorMessage(error));
    }
  };

  const resetFilters = () => {
    setCredits([]);
    setStatus([]);
    setKeyword('');
    setSearchText('');
    setPage(1);
  };

  const columns: ColumnsType<CardRow> = [
    { title: '编号', dataIndex: 'id', key: 'id', width: 80 },
    {
      title: '卡密',
      dataIndex: 'cardKey',
      key: 'cardKey',
      width: 300,
      render: (value: string) => (
        <Space size={2}>
          <span className="table-key" title={value}>
            {value}
          </span>
          <CopyButton
            value={value}
            onCopied={(ok) => {
              if (ok) void message.success('卡密已复制');
            }}
          />
        </Space>
      ),
    },
    {
      title: '额度',
      dataIndex: 'credits',
      key: 'credits',
      width: 120,
      render: (value: number) => <Tag color="green">{formatCredits(value)}</Tag>,
    },
    {
      title: '绑定账号',
      dataIndex: 'accountName',
      key: 'accountName',
      width: 220,
      render: (value: string | null) =>
        value ? (
          <span className="ellipsis" title={value} style={{ maxWidth: 200 }}>
            {value}
          </span>
        ) : (
          <span style={{ color: '#98A5A0' }}>未绑定</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: CardStatus) => {
        const meta = CARD_STATUS_META[value] ?? CARD_STATUS_META.active;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '兑换时间',
      dataIndex: 'redeemedAt',
      key: 'redeemedAt',
      width: 170,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '导入时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      width: 160,
      render: (value: string | null) => value || <span style={{ color: '#98A5A0' }}>—</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Switch
          size="small"
          checked={record.status === 'active'}
          loading={busyId === record.id}
          checkedChildren="可用"
          unCheckedChildren="停用"
          onChange={(checked) => {
            void handleToggle(record, checked);
          }}
        />
      ),
    },
  ];

  return (
    <>
      <div className="admin-toolbar">
        <Space wrap>
          <Select
            mode="multiple"
            allowClear
            placeholder="额度筛选"
            style={{ minWidth: 180 }}
            value={credits}
            options={creditSelectOptions}
            onChange={(value: number[]) => {
              setCredits(value);
              setPage(1);
            }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="状态筛选"
            style={{ minWidth: 160 }}
            value={status}
            options={CARD_STATUS_OPTIONS}
            onChange={(value: CardStatus[]) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <Input.Search
            allowClear
            placeholder="卡密 / 账号名"
            style={{ width: 220 }}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
            }}
          />
          <Button onClick={resetFilters}>重置</Button>
        </Space>

        <Space wrap>
          <Dropdown
            menu={{
              items: EXPORT_ITEMS,
              onClick: ({ key }) => {
                void handleExport(key as DeliverFormat);
              },
            }}
          >
            <Button icon={<DownloadOutlined />}>导出</Button>
          </Dropdown>
          <Popconfirm
            title={`停用选中的 ${selectedIds.length} 张卡密？`}
            okText="停用"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={selectedIds.length === 0}
            onConfirm={() => {
              void handleBatchDisable();
            }}
          >
            <Button danger disabled={selectedIds.length === 0} loading={disabling}>
              批量停用
            </Button>
          </Popconfirm>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              void load();
            }}
          >
            刷新列表
          </Button>
        </Space>
      </div>

      <div className="admin-card">
        <Table<CardRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1240 }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys.map((key) => Number(key))),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无卡密" />,
          }}
        />
      </div>
    </>
  );
}
