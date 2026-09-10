/**
 * Cardline 前端类型定义。
 *
 * 严格对齐 `docs/API.md`（前后端唯一事实来源）：字段名、枚举取值、可空性均以契约为准。
 */

/* ------------------------------------------------------------------ *
 * 枚举
 * ------------------------------------------------------------------ */

/** 交付格式 `deliverFormat` */
export type DeliverFormat = 'sub2api' | 'cpa' | 'email';

/** 取件导出分类 */
export type PickupExportKind = 'line' | 'email';

/** 封禁状态 */
export type BanStatus = 'unknown' | 'normal' | 'banned' | 'invalid';

/** 兑换状态 */
export type RedeemStatus = 'unredeemed' | 'redeemed';

/** 卡密状态 */
export type CardStatus = 'active' | 'disabled';

/** 取件状态 */
export type PickupStatus = 'ok' | 'failed';

/** 导入来源 */
export type ImportSource = 'paste' | 'upload';

/** 解析来源：四段式凭据行 / JSON / 卡密 / 仅邮箱 */
export type PickupSource = 'line' | 'json' | 'card' | 'email';

/** 邮件命中类型 */
export type MessageKind = 'code' | 'credits' | 'ban' | 'normal';

/** 排序方向（antd 风格） */
export type SortOrder = 'ascend' | 'descend';

/** 刷新目标 */
export type RefreshTarget = 'ban' | 'redeem';

/** 错误码 */
export type ApiErrorCode =
  | 'BAD_INPUT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CARD_INVALID'
  | 'PICKUP_FAILED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

/** 兑换结果码 */
export type RedeemResultCode = 'OK' | 'CARD_INVALID' | 'NO_STOCK' | 'CARD_DISABLED';

/* ------------------------------------------------------------------ *
 * 1.1 GET /api/public/meta
 * ------------------------------------------------------------------ */

export interface FormatOption {
  value: DeliverFormat;
  label: string;
  ext: string;
  hint: string;
}

export interface PublicCreditsStat {
  credits: number;
  total: number;
  available: number;
  redeemed: number;
}

export interface PublicStats {
  total: number;
  available: number;
  redeemed: number;
  byCredits: PublicCreditsStat[];
}

export interface PublicPickupMeta {
  enabled: boolean;
  direct: boolean;
}

export interface PublicMeta {
  siteName: string;
  siteSubtitle: string;
  formats: FormatOption[];
  creditTiers: number[];
  stats: PublicStats;
  pickup?: PublicPickupMeta;
}

/* ------------------------------------------------------------------ *
 * 1.2 POST /api/public/redeem
 * ------------------------------------------------------------------ */

export interface RedeemRequest {
  cards: string[];
  format: DeliverFormat;
  /** 每张卡本次取用账号数量，默认 1，最大 20（仅首次兑换生效） */
  limit?: number;
}

export interface RedeemAccount {
  id: number;
  name: string;
  credits: number;
  planType: string | null;
  email: string | null;
}

export interface RedeemResult {
  card: string;
  ok: boolean;
  code: RedeemResultCode;
  message: string;
  credits: number | null;
  accountCount: number;
  redeemedAt?: string | null;
  firstRedeem?: boolean;
  filename: string | null;
  content: string | null;
  accounts: RedeemAccount[];
}

export interface RedeemSummary {
  total: number;
  success: number;
  failed: number;
  credits: number;
  accounts: number;
}

export interface RedeemResponse {
  format: DeliverFormat;
  results: RedeemResult[];
  summary: RedeemSummary;
}

/* ------------------------------------------------------------------ *
 * 1.3 POST /api/public/pickup/resolve
 * ------------------------------------------------------------------ */

/** 前端读取文件后的纯文本内容 */
export interface ImportFile {
  name: string;
  content: string;
}

export interface PickupResolveRequest {
  input?: string;
  files?: ImportFile[];
}

export interface PickupRecord {
  /** 去重键（邮箱小写） */
  key: string;
  email: string;
  source: PickupSource;
  complete: boolean;
  fromCard: string | null;
  credits: number | null;
  accountId: number | null;
  label: string;
  error: string | null;
}

export interface PickupResolveSummary {
  total: number;
  complete: number;
  incomplete: number;
  unknown: number;
}

export interface PickupResolveResponse {
  records: PickupRecord[];
  summary: PickupResolveSummary;
  unknown: string[];
}

/* ------------------------------------------------------------------ *
 * 1.4 POST /api/public/pickup/fetch
 * ------------------------------------------------------------------ */

export interface PickupFetchRecordInput {
  key: string;
  email: string;
  /** 四段式凭据行；不传时服务端按 key / fromCard 回查数据库 */
  line?: string;
  fromCard?: string | null;
}

export interface PickupFetchRequest {
  records: PickupFetchRecordInput[];
  maxMessages?: number;
  query?: string;
}

export interface MailMessage {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  bodyHtml: string | null;
  code: string | null;
  credits: number | null;
  balance: number | null;
  kind: MessageKind;
}

export interface PickupResult {
  key: string;
  email: string;
  ok: boolean;
  error: string | null;
  banned: boolean;
  banReason: string | null;
  banKeywords: string[];
  credits: number | null;
  creditsBalance: number | null;
  latestCode: string | null;
  accountId: number | null;
  cardKey: string | null;
  fetchedAt: string;
  messages: MailMessage[];
}

export interface PickupFetchSummary {
  total: number;
  success: number;
  failed: number;
  banned: number;
  withCredits: number;
}

export interface PickupFetchResponse {
  results: PickupResult[];
  summary: PickupFetchSummary;
}

/* ------------------------------------------------------------------ *
 * 1.5 POST /api/public/pickup/export
 * ------------------------------------------------------------------ */

export interface PickupExportRequest {
  keys: string[];
  kind: PickupExportKind;
}

/* ------------------------------------------------------------------ *
 * 2. 鉴权
 * ------------------------------------------------------------------ */

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export interface OkResponse {
  ok: boolean;
}

/* ------------------------------------------------------------------ *
 * 3.1 GET /api/admin/accounts
 * ------------------------------------------------------------------ */

export type AccountSortField =
  | 'id'
  | 'name'
  | 'credits'
  | 'cardKey'
  | 'createdAt'
  | 'banStatus'
  | 'banCheckedAt'
  | 'redeemStatus'
  | 'redeemedAt'
  | 'updatedAt';

export interface AccountListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  credits?: number[];
  banStatus?: BanStatus[];
  redeemStatus?: RedeemStatus[];
  cardKey?: string;
  sortField?: AccountSortField;
  sortOrder?: SortOrder;
}

export interface AccountRow {
  id: number;
  name: string;
  email: string | null;
  credits: number;
  cardKey: string;
  createdAt: string;
  banStatus: BanStatus;
  banReason: string | null;
  banCheckedAt: string | null;
  redeemStatus: RedeemStatus;
  redeemedAt: string | null;
  redeemCount: number;
  planType: string | null;
  hasMailbox: boolean;
  batchId: string | null;
  remark: string | null;
  updatedAt: string;
}

export interface AccountCreditsSummary {
  credits: number;
  total: number;
  unredeemed: number;
  redeemed: number;
}

export interface AccountSummary {
  total: number;
  unredeemed: number;
  redeemed: number;
  banned: number;
  invalid: number;
  unknown: number;
  byCredits: AccountCreditsSummary[];
}

export interface AccountListResponse {
  items: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: AccountSummary;
}

/* ------------------------------------------------------------------ *
 * 3.2 POST /api/admin/accounts/import
 * ------------------------------------------------------------------ */

export interface ImportRequest {
  content?: string;
  files?: ImportFile[];
  credits: number;
  prefix?: string;
  source?: ImportSource;
  remark?: string;
  skipDuplicate?: boolean;
  keyLength?: number;
  keyGroups?: number;
}

export interface ImportErrorItem {
  index: number;
  name: string | null;
  reason: string;
}

export interface ImportSample {
  id: number;
  name: string;
  cardKey: string;
}

export interface ImportResponse {
  batchId: string;
  imported: number;
  skipped: number;
  failed: number;
  cards: string[];
  credits: number;
  errors: ImportErrorItem[];
  samples: ImportSample[];
}

/* ------------------------------------------------------------------ *
 * 3.3 POST /api/admin/accounts/generate-cards
 * ------------------------------------------------------------------ */

export interface GenerateCardsRequest {
  ids: number[];
  prefix?: string;
  regenerate?: boolean;
}

export interface GenerateCardsResponse {
  updated: number;
}

/* ------------------------------------------------------------------ *
 * 3.4 PATCH /api/admin/accounts/:id
 * ------------------------------------------------------------------ */

export interface UpdateAccountRequest {
  remark?: string | null;
  credits?: number;
  banStatus?: BanStatus;
  redeemStatus?: RedeemStatus;
}

/* ------------------------------------------------------------------ *
 * 3.5 / 3.6 批量删除 · 复制卡密
 * ------------------------------------------------------------------ */

export interface BatchDeleteAccountsRequest {
  ids: number[];
}

export interface BatchDeleteAccountsResponse {
  deleted: number;
}

export interface CopyCardResponse {
  id: number;
  cardKey: string;
  copyCount: number;
}

/* ------------------------------------------------------------------ *
 * 3.7 POST /api/admin/accounts/refresh-status
 * ------------------------------------------------------------------ */

export interface RefreshFilterPayload {
  credits?: number[];
  banStatus?: BanStatus[];
  redeemStatus?: RedeemStatus[];
  keyword?: string;
}

export interface RefreshStatusRequest {
  /** 模式 A：指定账号 */
  ids?: number[];
  /** 模式 B：按筛选条件 */
  filter?: RefreshFilterPayload;
  /** 模式 B 单次最多处理条数，默认 100，最大 500 */
  limit?: number;
  targets: RefreshTarget[];
}

export interface RefreshBanCounters {
  banned: number;
  normal: number;
  invalid: number;
  failed: number;
}

export interface RefreshRedeemCounters {
  redeemed: number;
  unredeemed: number;
  failed: number;
}

export interface RefreshStatusItem {
  id: number;
  banStatus: BanStatus;
  banReason: string | null;
  redeemStatus: RedeemStatus;
  redeemedAt: string | null;
  error: string | null;
}

export interface RefreshStatusResponse {
  requested: number;
  processed: number;
  ban?: RefreshBanCounters;
  redeem?: RefreshRedeemCounters;
  items: RefreshStatusItem[];
}

/* ------------------------------------------------------------------ *
 * 3.8 GET /api/admin/accounts/:id/mailbox
 * ------------------------------------------------------------------ */

export interface MailboxAccountInfo {
  id: number;
  name: string;
  email: string | null;
  credits: number;
  cardKey: string;
  banStatus: BanStatus;
  redeemStatus: RedeemStatus;
  createdAt: string;
}

export interface MailboxCredential {
  email: string;
  provider: string;
  authType: string;
  imapHost: string | null;
  imapPort: number | null;
  password: string | null;
  clientId: string | null;
  refreshToken: string | null;
  /** 完整四段式凭据行 */
  line: string | null;
}

export interface MailboxPickup {
  ok: boolean;
  error: string | null;
  banned: boolean;
  banReason: string | null;
  banKeywords: string[];
  credits: number | null;
  creditsBalance: number | null;
  latestCode: string | null;
  fetchedAt: string | null;
}

export interface MailboxQuery {
  /** 默认 10，最大 50 */
  maxMessages?: number;
  /** 1 时强制重新取件 */
  refresh?: number;
}

export interface MailboxResponse {
  account: MailboxAccountInfo;
  mailbox: MailboxCredential | null;
  pickup: MailboxPickup;
  messages: MailMessage[];
}

/* ------------------------------------------------------------------ *
 * 3.9 POST /api/admin/accounts/export
 * ------------------------------------------------------------------ */

export interface ExportAccountsRequest {
  format: DeliverFormat;
  filter?: RefreshFilterPayload;
  ids?: number[] | null;
  includeCardKey?: boolean;
  filename?: string;
}

/* ------------------------------------------------------------------ *
 * 3.10 GET /api/admin/stats/overview
 * ------------------------------------------------------------------ */

export interface OverviewAccounts {
  total: number;
  unredeemed: number;
  redeemed: number;
  banned: number;
  invalid: number;
}

export interface OverviewCards {
  total: number;
  redeemed: number;
  unredeemed: number;
}

export interface OverviewBatch {
  batchId: string;
  credits: number;
  count: number;
  createdAt: string;
  remark: string | null;
}

export interface RedeemTrendPoint {
  date: string;
  count: number;
}

export interface OverviewCreditsRow {
  credits: number;
  total: number;
  unredeemed: number;
  redeemed: number;
  banned: number;
}

export interface OverviewResponse {
  accounts: OverviewAccounts;
  cards: OverviewCards;
  batches: OverviewBatch[];
  redeemTrend: RedeemTrendPoint[];
  byCredits: OverviewCreditsRow[];
}

/* ------------------------------------------------------------------ *
 * 3.11 卡密管理
 * ------------------------------------------------------------------ */

export interface CardRow {
  id: number;
  cardKey: string;
  credits: number;
  accountId: number | null;
  accountName: string | null;
  status: CardStatus;
  redeemedAt: string | null;
  createdAt: string;
  remark: string | null;
}

export interface CardListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  credits?: number[];
  status?: CardStatus[];
  sortField?: string;
  sortOrder?: SortOrder;
}

export interface CardSummary {
  total: number;
  active: number;
  disabled: number;
  redeemed: number;
  unredeemed: number;
}

export interface CardListResponse {
  items: CardRow[];
  total: number;
  page: number;
  pageSize: number;
  summary?: CardSummary;
}

export interface UpdateCardRequest {
  status?: CardStatus;
  remark?: string;
}

export interface BatchDisableCardsRequest {
  ids: number[];
}

export interface BatchDisableCardsResponse {
  updated: number;
}

/* ------------------------------------------------------------------ *
 * 3.12 额度档位
 * ------------------------------------------------------------------ */

export interface CreditTier {
  id: number;
  credits: number;
  label: string;
  sort: number;
}

export interface CreditTierListResponse {
  items: CreditTier[];
}

export interface CreateCreditTierRequest {
  credits: number;
  label: string;
}

/* ------------------------------------------------------------------ *
 * 3.13 系统设置
 * ------------------------------------------------------------------ */

export interface Settings {
  siteName: string;
  siteSubtitle: string;
  pickupConcurrency: number;
  pickupMaxMessages: number;
  defaultFormat: DeliverFormat;
  redeemLimitPerCard: number;
  announcement: string;
}

export type SettingsPatch = Partial<Settings>;

/* ------------------------------------------------------------------ *
 * 通用
 * ------------------------------------------------------------------ */

/** 错误响应体（`docs/API.md` §0） */
export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

/** 带 Content-Disposition 的二进制下载 */
export interface DownloadPayload {
  blob: Blob;
  filename: string;
}
