/**
 * 展示层格式化工具（时间 / 字节 / 数字 / 状态元数据）。
 */

import dayjs from 'dayjs';

import type { BanStatus, CardStatus, CreditStatus, MessageKind, RedeemStatus } from '../api/types';

/* ------------------------------------------------------------------ *
 * 时间
 * ------------------------------------------------------------------ */

/** `YYYY-MM-DD HH:mm:ss`（契约要求的前端展示格式） */
export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : String(value);
}

/** `YYYY-MM-DD` */
export function formatDay(value?: string | null): string {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD') : String(value);
}

/** 今天显示 `HH:mm`，其余显示 `MM-DD HH:mm` */
export function formatShortTime(value?: string | null): string {
  if (!value) return '—';
  const date = dayjs(value);
  if (!date.isValid()) return String(value);
  return date.isSame(dayjs(), 'day') ? date.format('HH:mm') : date.format('MM-DD HH:mm');
}

/** 相对时间，超过 30 天回落为具体日期 */
export function formatRelative(value?: string | null): string {
  if (!value) return '—';
  const date = dayjs(value);
  if (!date.isValid()) return String(value);

  const diffSeconds = dayjs().diff(date, 'second');
  if (diffSeconds < 60) return '刚刚';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  if (diffSeconds < 2592000) return `${Math.floor(diffSeconds / 86400)} 天前`;
  return date.format('YYYY-MM-DD');
}

/** 文件名用的时间戳 `YYYYMMDD-HHmmss` */
export function timestampSuffix(): string {
  return dayjs().format('YYYYMMDD-HHmmss');
}

/* ------------------------------------------------------------------ *
 * 数字 / 字节
 * ------------------------------------------------------------------ */

export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US');
}

export function formatCredits(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${formatNumber(value)} 额度`;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  const rounded = index === 0 || size >= 100 ? Math.round(size) : Number(size.toFixed(1));
  return `${rounded} ${units[index]}`;
}

/* ------------------------------------------------------------------ *
 * 文本
 * ------------------------------------------------------------------ */

export function truncate(value: string | null | undefined, max = 48): string {
  if (!value) return '';
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ellipsisMiddle(value: string | null | undefined, head = 10, tail = 6): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function maskSecret(value?: string | null, mask = '••••••••'): string {
  return value && value.trim() ? mask : '—';
}

/** 去掉文件名中的非法字符 */
export function safeFilename(name: string, fallback = 'download'): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
  return cleaned || fallback;
}

/* ------------------------------------------------------------------ *
 * 状态元数据
 * ------------------------------------------------------------------ */

export interface StatusMeta {
  label: string;
  /** antd Tag 的 color 取值 */
  color: string;
  /** 主题色（用于自定义圆点 / 边框） */
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'idle';
}

export const BAN_STATUS_META: Record<BanStatus, StatusMeta> = {
  unknown: { label: '未检测', color: 'default', tone: 'idle' },
  normal: { label: '正常', color: 'success', tone: 'ok' },
  banned: { label: '已封禁', color: 'error', tone: 'danger' },
  invalid: { label: '凭据失效', color: 'warning', tone: 'warn' },
};

export const REDEEM_STATUS_META: Record<RedeemStatus, StatusMeta> = {
  unredeemed: { label: '未兑换', color: 'default', tone: 'idle' },
  redeemed: { label: '已兑换', color: 'processing', tone: 'info' },
};

/** 额度档位状态：pending = 邮箱取件还没命中额度关键字，不进兑换池 */
export const CREDIT_STATUS_META: Record<CreditStatus, StatusMeta> = {
  pending: { label: '待定档', color: 'warning', tone: 'warn' },
  ready: { label: '已定档', color: 'success', tone: 'ok' },
};

export const CARD_STATUS_META: Record<CardStatus, StatusMeta> = {
  active: { label: '可用', color: 'success', tone: 'ok' },
  disabled: { label: '已停用', color: 'default', tone: 'idle' },
};

export const MESSAGE_KIND_META: Record<MessageKind, StatusMeta> = {
  code: { label: '验证码', color: 'lime', tone: 'ok' },
  credits: { label: '额度', color: 'blue', tone: 'info' },
  ban: { label: '封禁', color: 'error', tone: 'danger' },
  normal: { label: '普通', color: 'default', tone: 'idle' },
};

/** 封禁状态下拉选项 */
export const BAN_STATUS_OPTIONS: Array<{ value: BanStatus; label: string }> = [
  { value: 'unknown', label: '未知' },
  { value: 'normal', label: '正常' },
  { value: 'banned', label: '已封禁' },
  { value: 'invalid', label: '凭据失效' },
];

/** 兑换状态下拉选项 */
export const REDEEM_STATUS_OPTIONS: Array<{ value: RedeemStatus; label: string }> = [
  { value: 'unredeemed', label: '未兑换' },
  { value: 'redeemed', label: '已兑换' },
];

/** 卡密状态下拉选项 */
export const CARD_STATUS_OPTIONS: Array<{ value: CardStatus; label: string }> = [
  { value: 'active', label: '可用' },
  { value: 'disabled', label: '已停用' },
];
