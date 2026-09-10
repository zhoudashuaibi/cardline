import { useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Empty, Input, Radio, Spin, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

import type { MailMessage, PickupResult } from '../api/types';
import { formatDateTime, formatShortTime } from '../utils/format';
import CopyButton from './CopyButton';

export type MailFilter = 'all' | 'success' | 'failed' | 'banned' | 'credits';

export interface MailBrowserProps {
  /** 取件结果（每个元素为一个账号及其邮件） */
  results: PickupResult[];
  loading?: boolean;
  emptyText?: string;
  /** 左侧邮件列表最大高度 */
  listHeight?: number;
  /** 右侧正文 iframe 高度 */
  frameHeight?: number;
}

interface Selection {
  key: string;
  /** null 表示该账号级别的视图（通常是取件失败） */
  messageId: string | null;
}

const FRAME_STYLE = `<style>
  html { color-scheme: light; }
  body { margin: 0; padding: 18px; font-family: 'Inter', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 13px; line-height: 1.75; color: #2C3A35; background: #FFFFFF; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #1F4A3C; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; margin: 0; }
</style>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 构造 iframe 的 srcDoc：优先使用服务端已净化的 bodyHtml，否则回落到纯文本预览。 */
function buildSrcDoc(message: MailMessage): string {
  const html = message.bodyHtml?.trim();
  if (html) {
    if (/<html[\s>]/i.test(html)) return html;
    return `<!doctype html><html><head><meta charset="utf-8">${FRAME_STYLE}</head><body>${html}</body></html>`;
  }

  const text = escapeHtml(message.bodyPreview?.trim() || '（无正文内容）');
  return `<!doctype html><html><head><meta charset="utf-8">${FRAME_STYLE}</head><body><pre>${text}</pre></body></html>`;
}

/**
 * 邮件浏览器：筛选工具条 + 左侧邮件列表 + 右侧详情。
 *
 * 前台 `/pickup` 与后台账号「取件」弹窗共用。
 */
export default function MailBrowser({
  results,
  loading = false,
  emptyText = '取件结果会按账号展示验证码、额度与封禁检测结果。',
  listHeight = 620,
  frameHeight = 460,
}: MailBrowserProps) {
  const { message: messageApi } = AntApp.useApp();
  const [filter, setFilter] = useState<MailFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);

  const counts = useMemo(
    () => ({
      all: results.length,
      success: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      banned: results.filter((item) => item.banned).length,
      credits: results.filter((item) => typeof item.credits === 'number' && item.credits > 0).length,
    }),
    [results],
  );

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();

    return results.filter((result) => {
      if (filter === 'success' && !result.ok) return false;
      if (filter === 'failed' && result.ok) return false;
      if (filter === 'banned' && !result.banned) return false;
      if (filter === 'credits' && !(typeof result.credits === 'number' && result.credits > 0)) {
        return false;
      }
      if (!needle) return true;

      const haystack = [
        result.email,
        result.key,
        result.error ?? '',
        ...result.messages.flatMap((item) => [item.subject, item.from, item.bodyPreview]),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [results, filter, keyword]);

  /** 结果集变化时自动选中第一项 */
  useEffect(() => {
    if (filtered.length === 0) {
      setSelection(null);
      return;
    }

    setSelection((previous) => {
      if (previous && filtered.some((item) => item.key === previous.key)) return previous;
      const first = filtered[0];
      const firstMessage = first.messages[0];
      return { key: first.key, messageId: firstMessage ? firstMessage.id : null };
    });
  }, [filtered]);

  /** 当前邮箱在筛选结果里的位次（-1 表示未选中） */
  const activeIndex = useMemo(
    () => (selection ? filtered.findIndex((item) => item.key === selection.key) : -1),
    [filtered, selection],
  );

  /**
   * 左侧只渲染当前邮箱的邮件。
   *
   * 一次取多个邮箱时，若把所有邮箱的邮件堆在同一个列表里，第一个邮箱的邮件就会占满
   * 整个滚动区，其余邮箱全被挤到下面看不见 —— 所以多邮箱时用上方切换条切换。
   */
  const visibleGroups = useMemo(
    () => (selection ? filtered.filter((item) => item.key === selection.key) : filtered),
    [filtered, selection],
  );

  /** 切换到某个邮箱：默认选中它最新的一封邮件 */
  const selectAccount = (result: PickupResult): void => {
    const firstMessage = result.messages[0];
    setSelection({ key: result.key, messageId: firstMessage ? firstMessage.id : null });
  };

  const activeResult = useMemo(() => {
    if (!selection) return null;
    return (
      filtered.find((item) => item.key === selection.key) ??
      results.find((item) => item.key === selection.key) ??
      null
    );
  }, [selection, filtered, results]);

  const activeMessage = useMemo(() => {
    if (!activeResult || !selection?.messageId) return null;
    return activeResult.messages.find((item) => item.id === selection.messageId) ?? null;
  }, [activeResult, selection]);

  const activeCode = activeMessage?.code ?? null;
  const activeCredits = activeMessage?.credits ?? null;
  const activeBalance = activeMessage?.balance ?? null;

  const srcDoc = useMemo(() => (activeMessage ? buildSrcDoc(activeMessage) : ''), [activeMessage]);

  const copyCode = async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      void messageApi.success('验证码已复制');
    } catch {
      void messageApi.warning('浏览器拒绝了剪贴板访问，请手动选择复制');
    }
  };

  const filterOptions = [
    { label: `全部 ${counts.all}`, value: 'all' },
    { label: `成功 ${counts.success}`, value: 'success' },
    { label: `失败 ${counts.failed}`, value: 'failed' },
    { label: `已封禁 ${counts.banned}`, value: 'banned' },
    { label: `有额度 ${counts.credits}`, value: 'credits' },
  ];

  return (
    <section className="mail-browser">
      <div className="mail-browser__toolbar">
        <Radio.Group
          size="small"
          optionType="button"
          buttonStyle="solid"
          value={filter}
          options={filterOptions}
          onChange={(event) => setFilter(event.target.value as MailFilter)}
        />
        <Input
          allowClear
          size="small"
          style={{ width: 260 }}
          prefix={<SearchOutlined style={{ color: '#98A5A0' }} />}
          placeholder="搜索主题 / 发件人 / 正文"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      {filtered.length > 1 ? (
        <div className="mail-accounts">
          <span className="mail-accounts__hint">
            共 {filtered.length} 个邮箱
            {activeIndex >= 0 ? ` · 当前第 ${activeIndex + 1} 个` : ''} · 点邮箱名切换
          </span>
          <div className="mail-accounts__list cardline-scroll">
            {filtered.map((result, index) => (
              <button
                type="button"
                key={result.key}
                title={result.email || result.key}
                className={`mail-account${
                  result.key === selection?.key ? ' mail-account--active' : ''
                }`}
                onClick={() => selectAccount(result)}
              >
                <span className="mail-account__index">{index + 1}</span>
                <span className="mail-account__email ellipsis">{result.email || result.key}</span>
                {!result.ok ? <Tag color="error">失败</Tag> : null}
                {result.banned ? <Tag color="error">已封禁</Tag> : null}
                {typeof result.credits === 'number' && result.credits > 0 ? (
                  <Tag color="blue">+{result.credits}</Tag>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mail-browser__grid">
        <Spin spinning={loading} tip="加载中…">
          <div className="mail-list cardline-scroll" style={{ maxHeight: listHeight }}>
            {filtered.length === 0 ? (
              <div className="mail-list__empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={results.length === 0 ? emptyText : '没有符合筛选条件的邮件'}
                />
              </div>
            ) : (
              visibleGroups.map((result) => (
                <div className="mail-group" key={result.key}>
                  <div className="mail-group__head">
                    <span className="mail-group__email ellipsis" title={result.email || result.key}>
                      {result.email || result.key}
                    </span>
                    <span className="mail-group__tags">
                      {result.banned ? <Tag color="error">已封禁</Tag> : null}
                      {typeof result.credits === 'number' && result.credits > 0 ? (
                        <Tag color="blue">+{result.credits} credits</Tag>
                      ) : null}
                      {typeof result.tier === 'number' && result.tier > 0 ? (
                        <Tag color="green">已定档 {result.tier} 额度</Tag>
                      ) : null}
                      {!result.ok ? <Tag color="error">取件失败</Tag> : null}
                    </span>
                  </div>

                  {result.messages.map((item) => {
                    const active =
                      selection !== null && selection.key === result.key && selection.messageId === item.id;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`mail-item${active ? ' mail-item--active' : ''}`}
                        onClick={() => setSelection({ key: result.key, messageId: item.id })}
                      >
                        <span className="mail-item__top">
                          <span className="mail-item__subject" title={item.subject}>
                            {item.subject || '（无主题）'}
                          </span>
                          <span className="mail-item__date">
                            {formatShortTime(item.receivedDateTime)}
                          </span>
                        </span>
                        <span className="mail-item__from" title={item.from}>
                          {item.from}
                        </span>
                        <span className="mail-item__preview">{item.bodyPreview}</span>
                        <span className="mail-item__tags">
                          {item.code ? <Tag color="lime">验证码 {item.code}</Tag> : null}
                          {typeof item.credits === 'number' && item.credits > 0 ? (
                            <Tag color="blue">+{item.credits} credits</Tag>
                          ) : null}
                          {result.banned ? <Tag color="error">已封禁</Tag> : null}
                          {item.isRead === false ? <Tag>未读</Tag> : null}
                        </span>
                      </button>
                    );
                  })}

                  {result.ok && result.messages.length === 0 ? (
                    <div className="mail-item__preview" style={{ padding: '6px 12px' }}>
                      该账号最近的邮件为空
                    </div>
                  ) : null}

                  {!result.ok ? (
                    <button
                      type="button"
                      className={`mail-item mail-item--error${
                        selection !== null &&
                        selection.key === result.key &&
                        selection.messageId === null
                          ? ' mail-item--active'
                          : ''
                      }`}
                      onClick={() => setSelection({ key: result.key, messageId: null })}
                    >
                      <span className="mail-item__top">
                        <span className="mail-item__subject">取件失败</span>
                      </span>
                      <span className="mail-item__preview">{result.error ?? '未知错误'}</span>
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Spin>

        <div className="mail-detail">
          {!activeResult ? (
            <div className="mail-detail__empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧邮件查看详情" />
            </div>
          ) : (
            <>
              <div className="mail-detail__to">
                收件人：{activeResult.email || activeResult.key}
              </div>

              {activeResult.banned ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="该账号命中封禁关键词"
                  description={
                    <div>
                      {activeResult.banReason ? <div>{activeResult.banReason}</div> : null}
                      {(activeResult.banKeywords ?? []).length > 0 ? (
                        <div style={{ marginTop: 6 }}>
                          {(activeResult.banKeywords ?? []).map((word) => (
                            <Tag color="error" key={word}>
                              {word}
                            </Tag>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  }
                />
              ) : null}

              {!activeResult.ok ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="取件失败"
                  description={activeResult.error ?? '未知错误'}
                />
              ) : null}

              {activeMessage ? (
                <>
                  <h3 className="mail-detail__subject">{activeMessage.subject || '（无主题）'}</h3>

                  <div className="mail-detail__meta">
                    <div className="mail-detail__meta-item">
                      <div className="mail-detail__meta-label">发件人</div>
                      <div className="mail-detail__meta-value mono" title={activeMessage.from}>
                        {activeMessage.from || '—'}
                      </div>
                    </div>
                    <div className="mail-detail__meta-item">
                      <div className="mail-detail__meta-label">时间</div>
                      <div className="mail-detail__meta-value">
                        {formatDateTime(activeMessage.receivedDateTime)}
                      </div>
                    </div>
                    <div className="mail-detail__meta-item">
                      <div className="mail-detail__meta-label">状态</div>
                      <div className="mail-detail__meta-value">
                        {activeMessage.isRead === false ? '未读' : '已读'}
                      </div>
                    </div>
                  </div>

                  {activeCode ? (
                    <div className="mail-extract">
                      <div>
                        <div className="mail-extract__label">智能提取 · 验证码</div>
                        <div className="mail-extract__value">{activeCode}</div>
                      </div>
                      <Button type="primary" onClick={() => void copyCode()}>
                        复制验证码
                      </Button>
                    </div>
                  ) : null}

                  {!activeCode && typeof activeCredits === 'number' && activeCredits > 0 ? (
                    <div className="mail-extract">
                      <div>
                        <div className="mail-extract__label">智能提取 · 额度</div>
                        <div className="mail-extract__credits">+{activeCredits} credits</div>
                        <div className="mail-extract__sub">
                          余额 {typeof activeBalance === 'number' ? activeBalance : '—'}
                        </div>
                      </div>
                      <CopyButton
                        type="default"
                        size="middle"
                        label="复制信息"
                        value={`+${activeCredits} credits / 余额 ${
                          typeof activeBalance === 'number' ? activeBalance : '—'
                        }`}
                        onCopied={(ok) => {
                          if (ok) void messageApi.success('已复制');
                        }}
                      />
                    </div>
                  ) : null}

                  <iframe
                    className="mail-frame"
                    title="邮件正文"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={srcDoc}
                    style={{ height: frameHeight }}
                  />
                </>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      activeResult.ok ? '该账号没有可取件的邮件' : '该账号取件失败，请查看上方原因'
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
