export interface MailboxCredential {
  email: string;
  provider?: string;
  authType?: string;
  password?: string;
  clientId?: string;
  refreshToken?: string;
  imapHost?: string;
  imapPort?: number;
  /** 完整四段式凭据行：邮箱----密码----clientid----refresh_token */
  line?: string;
}

/** 系统内部统一账号模型 —— sub2api / CPA / 邮箱 TXT 三种格式的公共中间表示 */
export interface NormalizedAccount {
  name: string;
  email?: string;
  planType?: string;
  accountId?: string;
  userId?: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  sessionToken?: string;
  expiresAt?: string;
  /** access_token 的 JWT exp（unix 秒） */
  accessTokenExpiresAt?: number;
  rawSource: 'sub2api' | 'cpa';
  /** 原始对象，保真回写 */
  raw?: Record<string, unknown>;
  mailbox?: MailboxCredential;
  /** 来自 sub2api 的附加字段 */
  concurrency?: number;
  priority?: number;
  rateMultiplier?: number;
  autoPauseOnExpired?: boolean;
  groupIds?: number[];
  extra?: Record<string, unknown>;
}

export interface Sub2ApiAccount {
  name: string;
  platform: string;
  type: string;
  credentials: Record<string, unknown>;
  extra?: Record<string, unknown>;
  notes?: string;
  concurrency?: number;
  priority?: number;
  rate_multiplier?: number;
  auto_pause_on_expired?: boolean;
  group_ids?: number[];
  expires_at?: number;
  id?: number;
}

export interface Sub2ApiDocument {
  type: string;
  version: number;
  exported_at: string;
  proxies: unknown[];
  accounts: Sub2ApiAccount[];
}

export interface CpaAccount {
  type: 'codex';
  email?: string;
  name?: string;
  plan_type?: string;
  chatgpt_plan_type?: string;
  account_id?: string;
  chatgpt_account_id?: string;
  id_token?: string;
  id_token_synthetic?: boolean;
  access_token: string;
  refresh_token?: string;
  session_token?: string;
  last_refresh?: string;
  expired?: string;
  disabled?: boolean;
}

export interface ConvertedItem {
  index: number;
  source: string;
  sourcePath: string;
  account: NormalizedAccount;
  cpa: CpaAccount;
  sub2api: Sub2ApiAccount;
  /** 四段式取件凭据行，可能为空 */
  emailLine?: string;
}

export interface ConvertIssue {
  index: number;
  source: string;
  path?: string;
  reason: string;
}

export interface ConvertResult {
  items: ConvertedItem[];
  issues: ConvertIssue[];
}
