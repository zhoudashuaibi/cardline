/**
 * Cardline API 客户端。
 *
 * 仅依赖原生 `fetch`，不引入任何 HTTP 库。
 * 每个函数对应 `docs/API.md` 中的一个端点，路径 / 方法 / 字段名与契约完全一致。
 */

import type {
  AccountListQuery,
  AccountListResponse,
  AccountRow,
  AuthUser,
  BatchDeleteAccountsRequest,
  BatchDeleteAccountsResponse,
  BatchDisableCardsRequest,
  BatchDisableCardsResponse,
  CardListQuery,
  CardListResponse,
  CardRow,
  ChangePasswordRequest,
  CopyCardResponse,
  CreateCreditTierRequest,
  CreditTier,
  CreditTierListResponse,
  DownloadPayload,
  ExportAccountsRequest,
  GenerateCardsRequest,
  GenerateCardsResponse,
  ImportRequest,
  ImportResponse,
  LoginRequest,
  LoginResponse,
  MailboxQuery,
  MailboxResponse,
  OkResponse,
  OverviewResponse,
  PickupExportRequest,
  PickupFetchRequest,
  PickupFetchResponse,
  PickupResolveRequest,
  PickupResolveResponse,
  PublicMeta,
  RedeemRequest,
  RedeemResponse,
  RefreshStatusRequest,
  RefreshStatusResponse,
  Settings,
  SettingsPatch,
  UpdateAccountRequest,
  UpdateCardRequest,
} from './types';

/* ------------------------------------------------------------------ *
 * 常量与错误类型
 * ------------------------------------------------------------------ */

export const API_BASE = '/api';
export const TOKEN_STORAGE_KEY = 'cardline.token';
export const UNAUTHORIZED_EVENT = 'cardline:unauthorized';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 把任意异常转成可展示的中文文案 */
export function errorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/* ------------------------------------------------------------------ *
 * token 读写
 * ------------------------------------------------------------------ */

export function getToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* localStorage 不可用时静默降级为内存态 */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * 401 广播（供 useAuth 清理登录态）
 * ------------------------------------------------------------------ */

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function emitUnauthorized(): void {
  unauthorizedListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* 监听器内部异常不应影响请求流程 */
    }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}

/* ------------------------------------------------------------------ *
 * 请求核心
 * ------------------------------------------------------------------ */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | Array<string | number> | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: '请求参数有误',
  401: '登录状态已失效，请重新登录',
  403: '没有权限执行此操作',
  404: '请求的资源不存在',
  409: '数据冲突，请刷新后重试',
  413: '上传内容过大',
  429: '请求过于频繁，请稍后再试',
  500: '服务端异常，请稍后再试',
  502: '上游服务异常',
  503: '服务暂不可用',
  504: '上游服务超时',
};

function buildUrl(path: string, query?: QueryParams): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = `${API_BASE}${normalized}`;
  if (!query) return base;

  const search = new URLSearchParams();
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      const list = value
        .filter((item) => item !== undefined && item !== null && String(item) !== '')
        .map((item) => String(item));
      if (list.length === 0) return;
      search.append(key, list.join(','));
      return;
    }

    search.append(key, String(value));
  });

  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessage(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const { message } = payload;

  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message)) {
    const parts = message.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    if (parts.length > 0) return parts.join('；');
  }
  return null;
}

async function toApiError(response: Response): Promise<ApiError> {
  const raw = await response.text().catch(() => '');
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = null;
    }
  }

  const record = isRecord(payload) ? payload : null;
  const message =
    readMessage(record) ?? STATUS_MESSAGES[response.status] ?? `请求失败（HTTP ${response.status}）`;
  const code = typeof record?.code === 'string' ? record.code : undefined;

  if (response.status === 401) {
    clearToken();
    emitUnauthorized();
  }

  return new ApiError(message, response.status, code, record?.details);
}

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* 继续尝试普通 filename */
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (plain?.[1]) {
    const name = plain[1].trim().replace(/^"|"$/g, '');
    if (name) return name;
  }
  return fallback;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, query, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('无法连接服务，请检查网络或服务端状态', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

/** 发起请求并解析 JSON */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('服务端返回了无法解析的数据', response.status, 'BAD_RESPONSE');
  }
}

/** 发起请求并返回二进制内容 + Content-Disposition 文件名 */
async function requestDownload(
  path: string,
  options: RequestOptions,
  fallbackName: string,
): Promise<DownloadPayload> {
  const response = await send(path, options);
  const blob = await response.blob();
  const filename = parseFilename(response.headers.get('Content-Disposition'), fallbackName);
  return { blob, filename };
}

/* ------------------------------------------------------------------ *
 * 下载工具
 * ------------------------------------------------------------------ */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(content: string, filename: string): void {
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
}

/* ------------------------------------------------------------------ *
 * 1. 公开接口
 * ------------------------------------------------------------------ */

/** `GET /api/public/meta` */
export function getPublicMeta(): Promise<PublicMeta> {
  return request<PublicMeta>('/public/meta');
}

/** `POST /api/public/redeem` */
export function redeemCards(payload: RedeemRequest): Promise<RedeemResponse> {
  return request<RedeemResponse>('/public/redeem', { method: 'POST', body: payload });
}

/** `POST /api/public/pickup/resolve` */
export function resolvePickup(payload: PickupResolveRequest): Promise<PickupResolveResponse> {
  return request<PickupResolveResponse>('/public/pickup/resolve', {
    method: 'POST',
    body: payload,
  });
}

/** `POST /api/public/pickup/fetch` */
export function fetchPickup(payload: PickupFetchRequest): Promise<PickupFetchResponse> {
  return request<PickupFetchResponse>('/public/pickup/fetch', { method: 'POST', body: payload });
}

/** `POST /api/public/pickup/export`（返回 text/plain 附件） */
export function exportPickupText(payload: PickupExportRequest): Promise<DownloadPayload> {
  return requestDownload(
    '/public/pickup/export',
    { method: 'POST', body: payload },
    'pickup-export.txt',
  );
}

/* ------------------------------------------------------------------ *
 * 2. 鉴权接口
 * ------------------------------------------------------------------ */

/** `POST /api/auth/login` */
export function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body: payload });
}

/** `GET /api/auth/profile` */
export function getProfile(): Promise<AuthUser> {
  return request<AuthUser>('/auth/profile');
}

/** `POST /api/auth/password` */
export function changePassword(payload: ChangePasswordRequest): Promise<OkResponse> {
  return request<OkResponse>('/auth/password', { method: 'POST', body: payload });
}

/* ------------------------------------------------------------------ *
 * 3.1 账号列表
 * ------------------------------------------------------------------ */

/** `GET /api/admin/accounts` */
export function listAccounts(query: AccountListQuery = {}): Promise<AccountListResponse> {
  return request<AccountListResponse>('/admin/accounts', {
    query: {
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      credits: query.credits,
      banStatus: query.banStatus,
      redeemStatus: query.redeemStatus,
      cardKey: query.cardKey,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    },
  });
}

/* ------------------------------------------------------------------ *
 * 3.2 / 3.3 导入 · 补发卡密
 * ------------------------------------------------------------------ */

/** `POST /api/admin/accounts/import` */
export function importAccounts(payload: ImportRequest): Promise<ImportResponse> {
  return request<ImportResponse>('/admin/accounts/import', { method: 'POST', body: payload });
}

/** `POST /api/admin/accounts/generate-cards` */
export function generateCards(payload: GenerateCardsRequest): Promise<GenerateCardsResponse> {
  return request<GenerateCardsResponse>('/admin/accounts/generate-cards', {
    method: 'POST',
    body: payload,
  });
}

/* ------------------------------------------------------------------ *
 * 3.4 - 3.6 单账号操作
 * ------------------------------------------------------------------ */

/** `PATCH /api/admin/accounts/:id` */
export function updateAccount(id: number, payload: UpdateAccountRequest): Promise<AccountRow> {
  return request<AccountRow>(`/admin/accounts/${id}`, { method: 'PATCH', body: payload });
}

/** `POST /api/admin/accounts/batch-delete` */
export function batchDeleteAccounts(ids: number[]): Promise<BatchDeleteAccountsResponse> {
  const payload: BatchDeleteAccountsRequest = { ids };
  return request<BatchDeleteAccountsResponse>('/admin/accounts/batch-delete', {
    method: 'POST',
    body: payload,
  });
}

/** `POST /api/admin/accounts/:id/copy-card` */
export function copyCard(id: number): Promise<CopyCardResponse> {
  return request<CopyCardResponse>(`/admin/accounts/${id}/copy-card`, { method: 'POST' });
}

/* ------------------------------------------------------------------ *
 * 3.7 刷新状态
 * ------------------------------------------------------------------ */

/** `POST /api/admin/accounts/refresh-status` */
export function refreshAccountStatus(
  payload: RefreshStatusRequest,
): Promise<RefreshStatusResponse> {
  return request<RefreshStatusResponse>('/admin/accounts/refresh-status', {
    method: 'POST',
    body: payload,
  });
}

/* ------------------------------------------------------------------ *
 * 3.8 账号邮箱取件
 * ------------------------------------------------------------------ */

/** `GET /api/admin/accounts/:id/mailbox` */
export function getAccountMailbox(id: number, query: MailboxQuery = {}): Promise<MailboxResponse> {
  return request<MailboxResponse>(`/admin/accounts/${id}/mailbox`, {
    query: { maxMessages: query.maxMessages, refresh: query.refresh },
  });
}

/* ------------------------------------------------------------------ *
 * 3.9 导出账号
 * ------------------------------------------------------------------ */

/** `POST /api/admin/accounts/export`（返回附件） */
export function exportAccountsBlob(payload: ExportAccountsRequest): Promise<DownloadPayload> {
  const ext = payload.format === 'email' ? 'txt' : 'json';
  const base = payload.filename?.trim() || `accounts-${payload.format}`;
  const fallback = /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`;
  return requestDownload('/admin/accounts/export', { method: 'POST', body: payload }, fallback);
}

/* ------------------------------------------------------------------ *
 * 3.10 统计概览
 * ------------------------------------------------------------------ */

/** `GET /api/admin/stats/overview` */
export function getOverview(): Promise<OverviewResponse> {
  return request<OverviewResponse>('/admin/stats/overview');
}

/* ------------------------------------------------------------------ *
 * 3.11 卡密管理
 * ------------------------------------------------------------------ */

/** `GET /api/admin/cards` */
export function listCards(query: CardListQuery = {}): Promise<CardListResponse> {
  return request<CardListResponse>('/admin/cards', {
    query: {
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      credits: query.credits,
      status: query.status,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    },
  });
}

/** `PATCH /api/admin/cards/:id` */
export function updateCard(id: number, payload: UpdateCardRequest): Promise<CardRow> {
  return request<CardRow>(`/admin/cards/${id}`, { method: 'PATCH', body: payload });
}

/** `POST /api/admin/cards/batch-disable` */
export function batchDisableCards(ids: number[]): Promise<BatchDisableCardsResponse> {
  const payload: BatchDisableCardsRequest = { ids };
  return request<BatchDisableCardsResponse>('/admin/cards/batch-disable', {
    method: 'POST',
    body: payload,
  });
}

/* ------------------------------------------------------------------ *
 * 3.12 额度档位
 * ------------------------------------------------------------------ */

/** `GET /api/admin/credit-tiers`（已解包 `items`） */
export async function listCreditTiers(): Promise<CreditTier[]> {
  const response = await request<CreditTierListResponse>('/admin/credit-tiers');
  const items = response?.items;
  return Array.isArray(items) ? items : [];
}

/** `POST /api/admin/credit-tiers` */
export function createCreditTier(payload: CreateCreditTierRequest): Promise<CreditTier> {
  return request<CreditTier>('/admin/credit-tiers', { method: 'POST', body: payload });
}

/** `DELETE /api/admin/credit-tiers/:id` */
export function deleteCreditTier(id: number): Promise<OkResponse> {
  return request<OkResponse>(`/admin/credit-tiers/${id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ *
 * 3.13 系统设置
 * ------------------------------------------------------------------ */

/** `GET /api/admin/settings` */
export function getSettings(): Promise<Settings> {
  return request<Settings>('/admin/settings');
}

/** `PATCH /api/admin/settings` */
export function updateSettings(payload: SettingsPatch): Promise<Settings> {
  return request<Settings>('/admin/settings', { method: 'PATCH', body: payload });
}

/* ------------------------------------------------------------------ *
 * 便捷常量
 * ------------------------------------------------------------------ */

/** 契约默认额度档位（后台档位接口不可用时的兜底） */
export const DEFAULT_CREDIT_TIERS: number[] = [5, 10, 20, 50, 100, 200, 500, 1000];
