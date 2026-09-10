import { BadRequestException } from '@nestjs/common';
import type { ErrorCode } from './error-codes';

/** 抛出带业务 code 的异常 */
export function fail(status: number, code: ErrorCode, message: string, details?: unknown): never {
  throw new BadRequestException({ statusCode: status, code, message, details });
}

/** 业务异常（可自定义 HTTP 状态码与 code） */
export function bizError(code: ErrorCode, message: string, status = 400, details?: unknown): never {
  const error = new BadRequestException({ statusCode: status, code, message, details });
  throw error;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 返回第一个非空字符串（已 trim） */
export function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** 逐级安全取值：get(obj, 'a.b.c') */
export function get(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (isPlainObject(acc)) return acc[key];
    return undefined;
  }, value);
}

export function toInt(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

export function toPositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback;
}

/** 把 "100,200" / ["100","200"] / 100 统一成 number[] */
export function toIntArray(value: unknown): number[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [
    ...new Set(
      list
        .map((item) => Number(String(item).trim()))
        .filter((item) => Number.isFinite(item)),
    ),
  ];
}

/** 把 "banned,normal" / ["banned"] 统一成 string[] */
export function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

/** 从各种时间表示解析成 Date（支持 unix 秒 / 毫秒 / ISO 字符串） */
export function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/.test(trimmed)) return toDate(Number(trimmed));
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

/** unix 秒 → ISO 字符串 */
export function isoFromUnixSeconds(value: unknown): string | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return new Date(Math.trunc(num) * 1000).toISOString();
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function looksEmail(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return !text.includes('----') && EMAIL_PATTERN.test(text);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksClientId(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return !/\s/.test(text) && (UUID_PATTERN.test(text) || /^app_[A-Za-z0-9]{10,}$/.test(text));
}

export function looksRefreshToken(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return text.length >= 60 && !/\s/.test(text) && !text.startsWith('ey');
}

export function looksPassword(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return (
    text.length >= 4 &&
    text.length <= 64 &&
    !text.includes(' ') &&
    !text.includes('----') &&
    !looksEmail(text) &&
    !UUID_PATTERN.test(text) &&
    !text.startsWith('ey') &&
    !text.startsWith('rt.') &&
    !text.startsWith('M.C')
  );
}

/** 邮箱去重键 */
export function emailKey(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined;
  const key = email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || undefined;
}

const CARD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成卡密：PREFIX-XXXXX-XXXXX-XXXXX */
export function generateCardKey(prefix = 'CARD', groups = 3, length = 5): string {
  const safePrefix = (prefix || 'CARD').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CARD';
  const parts: string[] = [];
  for (let index = 0; index < groups; index++) {
    let chunk = '';
    for (let pos = 0; pos < length; pos++) {
      chunk += CARD_ALPHABET[Math.floor(Math.random() * CARD_ALPHABET.length)];
    }
    parts.push(chunk);
  }
  return [safePrefix, ...parts].join('-');
}

/** 归一化用户输入的卡密：去空白、转大写 */
export function normalizeCardKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** 按换行/空格/逗号/分号切分用户输入 */
export function splitTokens(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,;，；、|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 服务器安全文件名 */
export function safeFilename(value: unknown, fallback = 'download'): string {
  const text = String(value ?? '').trim() || fallback;
  const cleaned = text
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** 并发 worker 池 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/** 清理邮件 HTML：去脚本/事件/非法资源 */
export function sanitizeHtml(html: unknown): string {
  let output = String(html ?? '');
  if (!output) return '';
  output = output.replace(/<script[\s\S]*?<\/script>/gi, '');
  output = output.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  output = output.replace(/<(object|embed|form|base|link)\b[^>]*>/gi, '');
  output = output.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  output = output.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  output = output.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  output = output.replace(
    /\s(href|src)\s*=\s*"(?!https?:|mailto:|data:image\/|#)[^"]*"/gi,
    '',
  );
  output = output.replace(
    /\s(href|src)\s*=\s*'(?!https?:|mailto:|data:image\/|#)[^']*'/gi,
    '',
  );
  return output;
}

/** HTML → 纯文本 */
export function htmlToText(html: unknown): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从地址对象里取 "Name <addr>" */
export function formatSender(from: unknown): string {
  if (!from) return '未知发件人';
  if (typeof from === 'string') return from;
  const source = isPlainObject(from) ? from : {};
  const address = isPlainObject(source.emailAddress) ? source.emailAddress : source;
  const name = String(address.name ?? '').trim();
  const addr = String(address.address ?? '').trim();
  if (name && addr) return `${name} <${addr}>`;
  return addr || name || '未知发件人';
}
