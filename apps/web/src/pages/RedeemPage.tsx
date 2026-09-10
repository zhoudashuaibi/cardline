import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Input, InputNumber, Select, Tag } from 'antd';

import { downloadText, errorMessage, getPublicMeta, redeemCards } from '../api/client';
import type { DeliverFormat, PublicMeta, RedeemResponse, RedeemResult } from '../api/types';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import StatusDot from '../components/StatusDot';
import { formatNumber, timestampSuffix } from '../utils/format';
import './RedeemPage.css';

const { TextArea } = Input;

/** 一次提交的最大卡密数量（契约上限 500） */
const MAX_CARDS = 500;
/** 默认交付格式 */
const DEFAULT_FORMAT: DeliverFormat = 'sub2api';

const TEXTAREA_PLACEHOLDER = [
  'CARD-XXXXX-XXXXX-XXXXX',
  'CARD-XXXXX-XXXXX-XXXXX',
  'CARD-XXXXX-XXXXX-XXXXX',
].join('\n');

/**
 * 按换行 / 空格 / 逗号 / 分号切分卡密，去空、去重、转大写。
 */
export function parseCards(input: string): string[] {
  const seen = new Set<string>();
  const cards: string[] = [];

  input.split(/[\s,;，；]+/).forEach((raw) => {
    const value = raw.trim().toUpperCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    cards.push(value);
  });

  return cards;
}

const DELIVERY_STEPS: Array<{ index: string; title: string; desc: string; accent?: boolean }> = [
  {
    index: '01',
    title: '粘贴卡密',
    desc: '支持换行、空格、逗号和分号分隔',
    accent: true,
  },
  {
    index: '02',
    title: '服务端校验',
    desc: '按格式筛选可用记录，失败项单独保留',
  },
  {
    index: '03',
    title: '下载交付',
    desc: '结果在本地生成，敏感内容不写入页面外部',
  },
];

/**
 * 公共首页 · 卡密兑换页。
 */
export default function RedeemPage() {
  const { message } = AntApp.useApp();

  const [meta, setMeta] = useState<PublicMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [text, setText] = useState('');
  const [format, setFormat] = useState<DeliverFormat>(DEFAULT_FORMAT);
  const [limit, setLimit] = useState<number>(1);

  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<RedeemResponse | null>(null);
  const [statusText, setStatusText] = useState('等待输入卡密');

  useEffect(() => {
    let cancelled = false;

    getPublicMeta()
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        const formats = Array.isArray(data.formats) ? data.formats : [];
        const preferred = formats.find((item) => item.value === DEFAULT_FORMAT) ?? formats[0];
        if (preferred) setFormat(preferred.value);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => parseCards(text), [text]);

  const formatOptions = useMemo(() => {
    const formats = meta?.formats ?? [];
    if (formats.length > 0) {
      return formats.map((item) => ({ value: item.value, label: item.label, ext: item.ext }));
    }
    return [
      { value: 'sub2api' as DeliverFormat, label: 'sub2api', ext: 'json' },
      { value: 'cpa' as DeliverFormat, label: 'CPA', ext: 'json' },
      { value: 'email' as DeliverFormat, label: '邮箱 TXT', ext: 'txt' },
    ];
  }, [meta]);

  const formatLabel = useMemo(
    () => formatOptions.find((item) => item.value === format)?.label ?? format,
    [formatOptions, format],
  );

  const results: RedeemResult[] = response?.results ?? [];
  const successCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - successCount;
  const processed = results.length;
  const totalInRun = response?.summary.total ?? 0;

  const queueCapacity = useMemo(() => {
    if (!meta) return '—';
    const available = meta.stats?.available ?? 0;
    return available > 10000 ? '10,000' : formatNumber(available);
  }, [meta]);

  const handleSubmit = useCallback(async () => {
    if (cards.length === 0 || submitting) return;

    const submitted = cards.slice(0, MAX_CARDS);
    if (cards.length > MAX_CARDS) {
      void message.warning(`单次最多提交 ${MAX_CARDS} 张卡密，已截取前 ${MAX_CARDS} 张`);
    }

    setSubmitting(true);
    try {
      const data = await redeemCards({ cards: submitted, format, limit });
      setResponse(data);
      setStatusText(`已选择 ${formatLabel} · 共 ${submitted.length} 张`);
      void message.success(
        `兑换完成：成功 ${data.summary.success} 张，失败 ${data.summary.failed} 张`,
      );
    } catch (error) {
      void message.error(errorMessage(error));
      setStatusText('兑换请求失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }, [cards, format, formatLabel, limit, message, submitting]);

  const downloadSingle = useCallback((result: RedeemResult) => {
    downloadText(result.content ?? '', result.filename ?? `${result.card}.txt`);
  }, []);

  const downloadAll = useCallback(() => {
    if (!response?.mergedContent) {
      void message.warning('当前没有可下载的成功结果');
      return;
    }

    const ext =
      formatOptions.find((item) => item.value === response.format)?.ext ??
      (response.format === 'email' ? 'txt' : 'json');

    downloadText(
      response.mergedContent,
      `cardline-${response.format}-${timestampSuffix()}.${ext}`,
    );
  }, [formatOptions, message, response]);

  const downloadManifest = useCallback(() => {
    if (!response) {
      void message.warning('当前没有可导出的结果');
      return;
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      format: response.format,
      summary: response.summary,
      results: response.results.map((item) => ({
        card: item.card,
        ok: item.ok,
        code: item.code,
        message: item.message,
        credits: item.credits,
        accountCount: item.accountCount,
        redeemedAt: item.redeemedAt ?? null,
        firstRedeem: item.firstRedeem ?? null,
        filename: item.filename,
        accounts: item.accounts,
      })),
    };

    downloadText(
      JSON.stringify(manifest, null, 2),
      `cardline-manifest-${timestampSuffix()}.json`,
    );
  }, [message, response]);

  const clearQueue = useCallback(() => {
    setResponse(null);
    setStatusText('等待输入卡密');
  }, []);

  const hasResults = results.length > 0;
  const hasMerged = Boolean(response?.mergedContent);

  return (
    <div className="page">
      <SiteHeader />

      <main className="page__body">
        <div className="shell redeem-body">
          <div className="redeem-grid">
            {/* ----------------------------- 左栏 ----------------------------- */}
            <div className="redeem-left">
              <div className="eyebrow">SECURE REDEMPTION</div>
              <h1 className="redeem-title">卡密交付中心</h1>
              <p className="redeem-lead">
                输入卡密，校验通过后按所选格式生成交付文件。首次兑换会锁定本卡的账号，之后仍可重复切换格式导出，不会额外消耗额度。
              </p>

              <div className="info-bar">
                <StatusDot tone="ok" pulse label="交付节点在线" />
                <div className="info-bar__right">
                  <span className="info-bar__hint">服务端校验 · 原子扣减 · 结果可追溯</span>
                  <span className="info-bar__edge">EDGE / 01</span>
                </div>
              </div>

              <div className="stat-strip">
                <div className="stat-cell">
                  <div className="stat-cell__label">队列上限</div>
                  <div className="stat-cell__value">{queueCapacity}</div>
                  <div className="stat-cell__caption">每次提交</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell__label">账号锁定</div>
                  <div className="stat-cell__value">1:1</div>
                  <div className="stat-cell__caption">首次兑换后固定</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell__label">交付格式</div>
                  <div className="stat-cell__value stat-cell__value--sm">
                    {metaLoading ? '加载中' : `${meta?.formats?.length ?? 0} 种格式可用`}
                  </div>
                  <div className="stat-cell__caption">按需选择</div>
                </div>
              </div>

              <section className="flow">
                <div className="eyebrow flow__eyebrow">DELIVERY FLOW</div>
                <div className="flow__grid">
                  {DELIVERY_STEPS.map((step) => (
                    <div className="flow__step" key={step.index}>
                      <span className={`flow__chip${step.accent ? ' flow__chip--accent' : ''}`}>
                        {step.index}
                      </span>
                      <div className="flow__title">{step.title}</div>
                      <div className="flow__desc">{step.desc}</div>
                    </div>
                  ))}
                </div>
              </section>

              <p className="footnote">
                <span className="footnote__mark">+</span>
                请只在可信设备保存下载文件，管理员操作请进入独立后台。
              </p>
            </div>

            {/* --------------------------- 右栏：操作台 --------------------------- */}
            <aside className="console console--sticky redeem-console">
              <div className="console__head">
                <span className="console__eyebrow">REDEEM CONSOLE</span>
                <span className="console__pill">
                  <span className="status-dot__dot" aria-hidden="true" />
                  在线
                </span>
              </div>

              <h2 className="console__title">兑换并下载</h2>
              <p className="console__subtitle">一次处理多张卡密，成功与失败结果分开显示。</p>

              <label className="console__label" htmlFor="cardline-cards">
                卡密列表
              </label>
              <TextArea
                id="cardline-cards"
                rows={7}
                className="redeem-textarea"
                placeholder={TEXTAREA_PLACEHOLDER}
                value={text}
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
              />

              <div className="console__field-grid" style={{ marginTop: 16 }}>
                <div>
                  <span className="console__label">输出格式</span>
                  <Select
                    style={{ width: '100%' }}
                    value={format}
                    options={formatOptions}
                    onChange={(value: DeliverFormat) => setFormat(value)}
                  />
                </div>
                <div>
                  <span className="console__label">每张请求数量</span>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    max={20}
                    precision={0}
                    value={limit}
                    onChange={(value) => setLimit(typeof value === 'number' ? value : 1)}
                  />
                </div>
              </div>

              <div className="console__action-row">
                <span className="console__counter">{cards.length} 张有效卡密</span>
                <Button
                  type="primary"
                  className="console__primary"
                  loading={submitting}
                  disabled={cards.length === 0 || submitting}
                  onClick={() => {
                    void handleSubmit();
                  }}
                >
                  {submitting ? '兑换中…' : '开始兑换'}
                </Button>
              </div>
              <div className="console__helper">{statusText}</div>

              <div className="console__divider" />

              <div className="console__section-head">
                <span className="console__section-title">交付队列</span>
                <span className="console__section-summary">
                  {processed} / {totalInRun} 已处理 · 成功 {successCount} · 失败 {failedCount}
                </span>
              </div>

              <div className="console__ghost-row">
                <Button size="small" disabled={!hasMerged} onClick={downloadAll}>
                  合并下载全部
                </Button>
                <Button size="small" disabled={!hasResults} onClick={downloadManifest}>
                  结果清单
                </Button>
                <Button size="small" disabled={!hasResults} onClick={clearQueue}>
                  清空
                </Button>
              </div>

              {hasResults ? (
                <div className="console__queue cardline-scroll">
                  {results.map((item, index) => (
                    <div className="queue-row" key={`${item.card}-${index}`}>
                      <div className="queue-row__main">
                        <div className="queue-row__card" title={item.card}>
                          {item.card}
                        </div>
                        <div className={`queue-row__meta${item.ok ? '' : ' queue-row__error'}`}>
                          {item.ok
                            ? `${item.accountCount} 个账号 · ${formatNumber(item.credits ?? 0)} 额度`
                            : item.message}
                        </div>
                      </div>
                      <div className="queue-row__side">
                        <Tag color={item.ok ? 'success' : 'error'} style={{ margin: 0 }}>
                          {item.ok ? '成功' : '失败'}
                        </Tag>
                        {item.ok && item.content ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={() => downloadSingle(item)}
                          >
                            下载
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="console__empty">
                  成功的兑换会显示安全摘要和下载按钮；失败项会保留原因。
                </div>
              )}
            </aside>
          </div>
        </div>
      </main>

      <SiteFooter siteName={meta?.siteName ?? 'Cardline'} />
    </div>
  );
}
