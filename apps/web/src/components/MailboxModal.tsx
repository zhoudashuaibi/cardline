import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Collapse, Modal, Space, Spin, Tag } from 'antd';

import { errorMessage, getAccountMailbox, updateAccount } from '../api/client';
import type {
  AccountRow,
  MailboxCredential,
  MailboxResponse,
  PickupResult,
  UpdateAccountRequest,
} from '../api/types';
import { BAN_STATUS_META, REDEEM_STATUS_META, formatCredits } from '../utils/format';
import CopyButton from './CopyButton';
import MailBrowser from './MailBrowser';

export interface MailboxModalProps {
  open: boolean;
  account: AccountRow | null;
  onClose: () => void;
  /** 账号状态发生变化后通知父级刷新列表 */
  onChanged: () => void;
}

const MASK = '••••••••';

interface SecretRowProps {
  label: string;
  value: string | null;
}

function SecretRow({ label, value }: SecretRowProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="secret-row">
      <span className="secret-row__label">{label}</span>
      <span className="secret-row__value" title={visible && value ? value : undefined}>
        {value ? (visible ? value : MASK) : '—'}
      </span>
      <span className="secret-row__actions">
        <Button
          type="link"
          size="small"
          disabled={!value}
          onClick={() => setVisible((previous) => !previous)}
        >
          {visible ? '隐藏' : '显示'}
        </Button>
        <CopyButton value={value ?? ''} />
      </span>
    </div>
  );
}

/**
 * 后台账号「取件」弹窗：邮箱凭据 + 最新邮件 + 封禁/额度分析。
 */
export default function MailboxModal({ open, account, onClose, onChanged }: MailboxModalProps) {
  const { message } = AntApp.useApp();
  const accountId = account?.id ?? null;

  const [data, setData] = useState<MailboxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const response = await getAccountMailbox(accountId, { maxMessages: 10, refresh: 1 });
      setData(response);
    } catch (error) {
      setData(null);
      void message.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [accountId, message]);

  useEffect(() => {
    if (!open) {
      setData(null);
      return;
    }
    void load();
  }, [open, load]);

  const patch = useCallback(
    async (payload: UpdateAccountRequest, successText: string) => {
      if (!accountId) return;
      setSaving(true);
      try {
        await updateAccount(accountId, payload);
        void message.success(successText);
        onChanged();
        await load();
      } catch (error) {
        void message.error(errorMessage(error));
      } finally {
        setSaving(false);
      }
    },
    [accountId, load, message, onChanged],
  );

  const mailbox: MailboxCredential | null = data?.mailbox ?? null;
  const pickup = data?.pickup;
  const info = data?.account;

  /** 把弹窗数据结构换算成 MailBrowser 需要的取件结果 */
  const results = useMemo<PickupResult[]>(() => {
    if (!data || !info) return [];

    return [
      {
        key: info.email || info.name,
        email: info.email || info.name,
        ok: data.pickup.ok,
        error: data.pickup.error,
        banned: data.pickup.banned,
        banReason: data.pickup.banReason,
        banKeywords: data.pickup.banKeywords ?? [],
        credits: data.pickup.credits,
        creditsBalance: data.pickup.creditsBalance,
        latestCode: data.pickup.latestCode,
        accountId: info.id,
        cardKey: info.cardKey,
        fetchedAt: data.pickup.fetchedAt ?? new Date().toISOString(),
        messages: data.messages ?? [],
      },
    ];
  }, [data, info]);

  const pickupSummary = useMemo(() => {
    if (!pickup) return '';
    const parts: string[] = [];
    if (pickup.latestCode) parts.push(`命中验证码 ${pickup.latestCode}`);
    if (typeof pickup.credits === 'number') {
      parts.push(
        `额度 +${pickup.credits}${
          typeof pickup.creditsBalance === 'number' ? ` (余额 ${pickup.creditsBalance})` : ''
        }`,
      );
    }
    if (!pickup.banned) parts.push('未命中封禁关键词');
    return parts.join(' · ') || '取件成功，未发现验证码或额度信息';
  }, [pickup]);

  const banMeta = info ? BAN_STATUS_META[info.banStatus] : null;
  const redeemMeta = info ? REDEEM_STATUS_META[info.redeemStatus] : null;

  return (
    <Modal
      open={open}
      width={1040}
      title={`邮箱取件 · ${account?.name ?? ''}`}
      onCancel={onClose}
      destroyOnClose
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="redeemed"
          loading={saving}
          onClick={() => {
            void patch({ redeemStatus: 'redeemed' }, '已标记为已兑换');
          }}
        >
          标记为已兑换
        </Button>,
        info?.banStatus === 'banned' ? (
          <Button
            key="ban"
            loading={saving}
            onClick={() => {
              void patch({ banStatus: 'normal' }, '已标记为正常');
            }}
          >
            标记为正常
          </Button>
        ) : (
          <Button
            key="ban"
            danger
            loading={saving}
            onClick={() => {
              void patch({ banStatus: 'banned' }, '已标记为已封禁');
            }}
          >
            标记为已封禁
          </Button>
        ),
      ]}
    >
      <Spin spinning={loading} tip="正在取件…">
        {!data ? (
          <div style={{ minHeight: 320 }} />
        ) : (
          <div>
            <div className="pickup-summary">
              <div>
                <div className="pickup-summary__label">邮箱</div>
                <div className="pickup-summary__value">{info?.email || info?.name || '—'}</div>
              </div>
              <div>
                <div className="pickup-summary__label">额度</div>
                <div className="pickup-summary__value">{formatCredits(info?.credits)}</div>
              </div>
              <div>
                <div className="pickup-summary__label">卡密</div>
                <div className="pickup-summary__value mono">
                  <Space size={2}>
                    <span className="ellipsis" style={{ maxWidth: 240 }} title={info?.cardKey}>
                      {info?.cardKey || '—'}
                    </span>
                    <CopyButton
                      value={info?.cardKey ?? ''}
                      onCopied={(ok) => {
                        if (ok) void message.success('卡密已复制');
                      }}
                    />
                  </Space>
                </div>
              </div>
              <div>
                <div className="pickup-summary__label">封禁状态</div>
                <div className="pickup-summary__value">
                  {banMeta ? <Tag color={banMeta.color}>{banMeta.label}</Tag> : '—'}
                </div>
              </div>
              <div>
                <div className="pickup-summary__label">兑换状态</div>
                <div className="pickup-summary__value">
                  {redeemMeta ? <Tag color={redeemMeta.color}>{redeemMeta.label}</Tag> : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button
                  onClick={() => {
                    void load();
                  }}
                >
                  重新取件
                </Button>
              </div>
            </div>

            <Collapse
              ghost
              style={{ marginBottom: 14 }}
              items={[
                {
                  key: 'credential',
                  label: '凭据',
                  children: mailbox ? (
                    <div>
                      <SecretRow label="邮箱" value={mailbox.email} />
                      <SecretRow label="密码" value={mailbox.password} />
                      <SecretRow label="客户端ID" value={mailbox.clientId} />
                      <SecretRow label="刷新令牌" value={mailbox.refreshToken} />
                      <SecretRow label="凭据行" value={mailbox.line} />
                      <div style={{ marginTop: 10 }}>
                        <CopyButton
                          type="default"
                          size="small"
                          label="复制凭据行"
                          value={mailbox.line ?? ''}
                          onCopied={(ok) => {
                            if (ok) void message.success('凭据行已复制');
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <Alert type="warning" showIcon message="该账号没有可用的邮箱凭据" />
                  ),
                },
              ]}
            />

            {pickup?.banned ? (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message="该账号命中封禁关键词"
                description={
                  <div>
                    {pickup.banReason ? <div>{pickup.banReason}</div> : null}
                    <div style={{ marginTop: 6 }}>
                      {(pickup.banKeywords ?? []).map((word) => (
                        <Tag color="error" key={word}>
                          {word}
                        </Tag>
                      ))}
                    </div>
                  </div>
                }
              />
            ) : null}

            {pickup?.ok ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 12 }}
                message={pickupSummary}
                description={
                  pickup.fetchedAt ? `取件时间：${new Date(pickup.fetchedAt).toLocaleString()}` : undefined
                }
              />
            ) : (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message="取件失败"
                description={pickup?.error ?? '未知错误'}
              />
            )}

            <MailBrowser
              results={results}
              loading={loading}
              listHeight={420}
              frameHeight={400}
              emptyText="该账号暂无邮件"
            />
          </div>
        )}
      </Spin>
    </Modal>
  );
}
