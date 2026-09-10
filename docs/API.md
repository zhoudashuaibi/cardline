# 卡密兑换系统 · 接口契约 (API Contract)

> 本文件是前后端唯一事实来源。前后端都必须严格按此实现。

- Base URL: `http://localhost:3000/api`
- 全部请求/响应为 `application/json; charset=utf-8`
- 时间字段一律为 ISO8601 字符串（UTC），前端自行格式化为 `YYYY-MM-DD HH:mm:ss`
- 金额/额度为整数 `credits`；**账号额度只来自邮箱取件命中额度关键字（档位 = 命中 credits ÷ 25），不提供手工录入**

## 0. 通用约定

### 成功响应

直接返回数据对象，不加包装。例如：

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20 }
```

### 错误响应

HTTP 4xx/5xx，body：

```json
{
  "statusCode": 400,
  "code": "BAD_INPUT",
  "message": "无法识别的 JSON 格式",
  "details": []
}
```

`code` 取值：`BAD_INPUT` | `UNAUTHORIZED` | `NOT_FOUND` | `CARD_INVALID` | `CARD_DISABLED` | `CREDITS_PENDING` | `NO_STOCK` | `CONFLICT` | `PICKUP_FAILED` | `UPSTREAM_ERROR` | `INTERNAL`

### 鉴权

后台接口需要 `Authorization: Bearer <token>`。token 由 `POST /api/auth/login` 下发（JWT，有效期 7 天）。

### 枚举

| 名称 | 值 |
| --- | --- |
| `credits`（额度 / 档位） | 非负整数。**只来自邮箱取件命中的额度关键字**：档位 = 命中 credits ÷ 25（向下取整）；`0` = 待定档（未命中），不进兑换池 |
| `creditStatus` | `pending` 待定档 / `ready` 已定档（= `credits > 0`） |
| `banStatus` | `unknown` 未知 / `normal` 正常 / `banned` 已封禁 / `invalid` 凭据失效 |
| `redeemStatus` | `unredeemed` 未兑换 / `redeemed` 已兑换 |
| `deliverFormat` | `sub2api` / `cpa` / `email` |
| `pickupStatus` | `ok` / `failed` |
| `importSource` | `paste` / `upload` |

---

## 1. 公开接口（前台，无需鉴权）

### 1.1 `GET /api/public/meta`

前台初始化数据（品牌信息、可用格式、额度档位、平台统计）。

```json
{
  "siteName": "Cardline",
  "siteSubtitle": "SECURE DELIVERY",
  "formats": [
    { "value": "sub2api", "label": "sub2api", "ext": "json", "hint": "sub2api 导入 JSON" },
    { "value": "cpa", "label": "CPA", "ext": "json", "hint": "Codex CPA auth JSON" },
    { "value": "email", "label": "邮箱 TXT", "ext": "txt", "hint": "邮箱----密码----clientid----refresh_token" }
  ],
  "creditTiers": [10, 20, 40],
  "stats": {
    "total": 1280,
    "available": 942,
    "redeemed": 338,
    "byCredits": [{ "credits": 40, "total": 400, "available": 300, "redeemed": 100 }]
  },
  "pickup": { "enabled": true, "direct": true }
}
```

`creditTiers` = **当前有货的档位**（由账号实际额度派生，只列 `available > 0` 的档位）；
`byCredits` 也只包含已定档（`credits > 0`）的账号，待定档账号不计入对外统计。

### 1.2 `POST /api/public/redeem`

卡密兑换并交付。**幂等**：同一张卡重复提交返回同一批账号；每张卡首次兑换时锁定账号，之后只允许切换格式重复导出，不再消耗新账号。

请求：

```json
{
  "cards": ["CARD-XXXXX-XXXXX-XXXXX", "CARD-YYYYY-YYYYY-YYYYY"],
  "format": "sub2api",
  "limit": 1
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cards` | string[] | 是 | 卡密数组，服务端会按换行/空格/逗号/分号二次切分，去重，最多 500 条 |
| `format` | `deliverFormat` | 是 | 交付格式 |
| `limit` | number | 否 | 每张卡本次取用账号数量，默认 1，最大 20。首次兑换后该卡的账号集合已被锁定，`limit` 只影响首次 |

响应：

```json
{
  "format": "sub2api",
  "results": [
    {
      "card": "CARD-XXXXX-XXXXX-XXXXX",
      "ok": true,
      "code": "OK",
      "message": "兑换成功",
      "credits": 100,
      "accountCount": 1,
      "redeemedAt": "2026-02-11T08:12:33.000Z",
      "firstRedeem": true,
      "filename": "CARD-XXXXX-XXXXX-XXXXX.sub2api.json",
      "content": "{\n  \"type\": \"sub2api-data\", ...\n}",
      "accounts": [
        {
          "id": 12,
          "name": "abc@outlook.com",
          "credits": 100,
          "planType": "plus",
          "email": "abc@outlook.com"
        }
      ]
    },
    {
      "card": "CARD-BAD",
      "ok": false,
      "code": "CARD_INVALID",
      "message": "卡密不存在",
      "credits": null,
      "accountCount": 0,
      "filename": null,
      "content": null,
      "accounts": []
    }
  ],
  "mergedContent": "{\n  \"type\": \"sub2api-data\", ...\n}",
  "summary": {
    "total": 2,
    "success": 1,
    "failed": 1,
    "credits": 100,
    "accounts": 1
  }
}
```

失败 `code` 取值：`CARD_INVALID` 卡密不存在 / `NO_STOCK` 该额度已无可用账号 / `CARD_DISABLED` 卡密已停用 / `CREDITS_PENDING` 账号额度待定（邮箱取件还没命中额度关键字，不进兑换池）。

#### `mergedContent` —— 「合并下载全部」

各卡的 `content` 是**每张卡一份**的独立文档，首尾相接并不是合法 JSON。`mergedContent` 是服务端把所有**成功结果**的账号合并成的**单份**文档，供前台「合并下载全部」使用；失败卡密不写入，全部失败时为 `null`。

| 格式 | 合并文件结构 |
| --- | --- |
| `sub2api` | `{ type: "sub2api-data", version, exported_at, proxies: [], accounts: [所有账号] }` |
| `cpa` | `{ accounts: [所有账号], exported_at, proxies: [] }`（对齐 `cpa_格式参考.json`；该参考里的 `x_revive_manifest` 含 Ed25519 签名，本服务没有签名私钥，故省略而不写无效签名） |
| `email` | 所有卡密的四段式凭据行直接拼接，不带任何分隔标题 |

合并文件可被本服务原样再导入（`POST /api/admin/accounts/import`）。

#### 交付产物里的 `extra`（含 2FA）

导入时账号的 `extra`（`auth_provider`、`privacy_mode`、`openai_*`、`two_factor_enabled` / `two_factor_status` / `two_factor_error` 等）存在数据库 `rawJson` 里，交付时按格式回填：

| 格式 | `extra` 位置 | 2FA |
| --- | --- | --- |
| `sub2api` | 账号对象的 `extra`（原字段原样 + 服务端补充的 `email` / `email_key` / `name` / `mailbox_*` / `source`） | 标记在 `extra.two_factor_*`；TOTP **密钥**在 `notes.two_factor.secret` |
| `cpa` | 账号对象的 `extra`（仅原字段原样，不注入服务端补充键） | 只有 `extra.two_factor_*` 标记；CPA 无 `notes`，**不含** TOTP 密钥 |
| `email` | 无 | 无（只有四段式凭据行） |

`extra` 的空串字段（如 `two_factor_error: ""`）按原样保留，保证交付文件与导入文件逐字段一致。来源没有 `extra` 时产物不写该键；CPA 的 `extra` 键集合与来源完全一致（含来源里本来就有的 `mailbox_*`）。

### 1.3 `POST /api/public/pickup/resolve`

把用户输入（卡密 / 邮箱 / 凭据行 / 上传的 txt、json 内容）解析成「可取件账号」列表，**只解析不取件**，用于前端预览与提交。

请求：

```json
{
  "input": "abc@outlook.com----pwd----clientid----rt...\nCARD-XXXXX-XXXXX-XXXXX\nother@outlook.com",
  "files": [
    { "name": "accounts.json", "content": "{...}" },
    { "name": "keys.txt", "content": "a----b----c----d\n" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `input` | string | 否 | 文本框内容，按行解析 |
| `files` | `{name, content}[]` | 否 | 前端读取文件后的纯文本内容，单文件上限 8MB |

响应：

```json
{
  "records": [
    {
      "key": "abc@outlook.com",
      "email": "abc@outlook.com",
      "source": "line",
      "complete": true,
      "fromCard": null,
      "credits": null,
      "accountId": null,
      "label": "凭据行",
      "error": null
    },
    {
      "key": "def@outlook.com",
      "email": "def@outlook.com",
      "source": "card",
      "complete": true,
      "fromCard": "CARD-XXXXX-XXXXX-XXXXX",
      "credits": 100,
      "accountId": 12,
      "label": "卡密",
      "error": null
    },
    {
      "key": "ghi@outlook.com",
      "email": "ghi@outlook.com",
      "source": "email",
      "complete": false,
      "fromCard": null,
      "credits": null,
      "accountId": null,
      "label": "仅邮箱",
      "error": "缺少取件凭据（密码/client_id/refresh_token）"
    }
  ],
  "summary": { "total": 3, "complete": 2, "incomplete": 1, "unknown": 0 },
  "unknown": ["not-an-email-or-card"]
}
```

`source` 取值：`line`（四段式凭据行）/ `json`（从 JSON 中提取）/ `card`（卡密，服务端补全凭据）/ `email`（只有邮箱）。
`key` 为去重键（邮箱小写）。

### 1.4 `POST /api/public/pickup/fetch`

执行取件（官方直连 Outlook）。服务端并发上限 4，单账号超时 30s，最多返回最新 10 封邮件。

请求：

```json
{
  "records": [
    { "key": "abc@outlook.com", "email": "abc@outlook.com", "line": "abc@outlook.com----pwd----clientid----rt...", "fromCard": null }
  ],
  "maxMessages": 10,
  "query": ""
}
```

- `line` 可省略或传 `null`。**凭据解析优先级**：`line`（且必须完整）→ 按 `fromCard` / `key` 回查数据库中的邮箱凭据 → `key` 本身（仅有邮箱时取件会返回「凭据不完整」）。
- 单次最多 20 条记录。

响应：

```json
{
  "results": [
    {
      "key": "abc@outlook.com",
      "email": "abc@outlook.com",
      "ok": true,
      "error": null,
      "banned": false,
      "banReason": null,
      "banKeywords": [],
      "credits": 500,
      "creditsBalance": 20,
      "latestCode": "123456",
      "accountId": 12,
      "cardKey": "CARD-XXXXX-XXXXX-XXXXX",
      "fetchedAt": "2026-02-11T08:20:00.000Z",
      "messages": [
        {
          "id": "AAMkAD...",
          "subject": "Your OpenAI verification code",
          "from": "OpenAI <noreply@openai.com>",
          "receivedDateTime": "2026-02-11T08:19:00.000Z",
          "isRead": false,
          "bodyPreview": "Your verification code is 123456",
          "bodyHtml": "<html>...</html>",
          "code": "123456",
          "credits": 500,
          "balance": 20,
          "kind": "code"
        }
      ]
    }
  ],
  "summary": { "total": 1, "success": 1, "failed": 0, "banned": 0, "withCredits": 1 }
}
```

- `kind`：`code` 命中验证码 / `credits` 命中额度 / `ban` 命中封禁关键词 / `normal`
- `bodyHtml` 已做服务端净化（去 `<script>`、`on*` 事件、非法 `src`/`href`）
- 取件失败时 `ok: false`，`error` 为人类可读原因（如「换 token 失败（invalid_grant）：refresh_token 可能已失效」）

### 1.5 `POST /api/public/pickup/export`

按分类导出账号（供前台「导出正常/异常/封禁」按钮使用）。返回纯文本。

请求：

```json
{
  "keys": ["abc@outlook.com"],
  "kind": "line"
}
```

`kind`：`line`（四段式凭据行）/ `email`（仅邮箱）

响应 `text/plain`，附件头 `Content-Disposition: attachment; filename="pickup-export.txt"`。

---

## 2. 鉴权接口

### 2.1 `POST /api/auth/login`

```json
{ "username": "admin", "password": "admin123" }
```

响应：

```json
{
  "token": "eyJhbGciOi...",
  "expiresIn": 604800,
  "user": { "id": 1, "username": "admin", "displayName": "管理员", "role": "admin" }
}
```

### 2.2 `GET /api/auth/profile`

响应同上 `user` 字段。

### 2.3 `POST /api/auth/password`

```json
{ "oldPassword": "admin123", "newPassword": "xxx" }
```

响应：`{ "ok": true }`

---

## 3. 后台 · 账号管理（需鉴权）

### 3.1 `GET /api/admin/accounts`

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `page` | number | 默认 1 |
| `pageSize` | number | 默认 20，最大 200 |
| `keyword` | string | 模糊匹配 账号名 / 邮箱 / 卡密 / 备注 |
| `credits` | number \| number[] | 额度筛选，多选逗号分隔 |
| `banStatus` | string \| string[] | 封禁状态筛选 |
| `redeemStatus` | string \| string[] | 兑换状态筛选 |
| `status` | `active` \| `disabled` | 卡密状态筛选（卡密管理页使用） |
| `cardKey` | string | 精确卡密 |
| `batchId` | string | 按导入批次筛选 |
| `sortField` | string | `id` \| `name` \| `credits` \| `cardKey` \| `createdAt` \| `updatedAt` \| `banStatus` \| `banCheckedAt` \| `redeemStatus` \| `redeemedAt` \| `planType` |
| `sortOrder` | string | `ascend` \| `descend`（也接受 `asc` / `desc`） |

响应：

```json
{
  "items": [
    {
      "id": 12,
      "name": "abc@outlook.com",
      "email": "abc@outlook.com",
      "credits": 40,
      "creditStatus": "ready",
      "cardKey": "CARD-XXXXX-XXXXX-XXXXX",
      "createdAt": "2026-02-11T08:00:00.000Z",
      "banStatus": "normal",
      "banReason": null,
      "banCheckedAt": "2026-02-11T08:10:00.000Z",
      "redeemStatus": "redeemed",
      "redeemedAt": "2026-02-11T08:12:33.000Z",
      "redeemCount": 1,
      "planType": "plus",
      "hasMailbox": true,
      "batchId": "b_20260211_080000",
      "remark": null,
      "updatedAt": "2026-02-11T08:12:33.000Z"
    }
  ],
  "total": 1280,
  "page": 1,
  "pageSize": 20,
  "summary": {
    "total": 1280,
    "unredeemed": 942,
    "redeemed": 338,
    "banned": 12,
    "invalid": 3,
    "unknown": 20,
    "pending": 96,
    "byCredits": [{ "credits": 40, "total": 400, "unredeemed": 300, "redeemed": 100, "banned": 4 }]
  }
}
```

`summary.pending` = 待定档账号数；`byCredits` 由账号实际额度聚合（含 `credits: 0` 的待定档分组）。

### 3.2 `POST /api/admin/accounts/import`

批量导入账号（自动切割 + 生成卡密）。支持直接粘贴 JSON 文本，或上传文件内容。

请求：

```json
{
  "content": "{ \"accounts\": [ ... ] }",
  "files": [{ "name": "sub2api_格式参考.json", "content": "{...}" }],
  "prefix": "CARD",
  "source": "paste",
  "remark": "2月批次",
  "skipDuplicate": true,
  "keyLength": 5,
  "keyGroups": 3
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `content` / `files` | 二选一 | 至少一个 |
| `prefix` | 否 | 卡密前缀，默认 `CARD` |
| `skipDuplicate` | 否 | 默认 `true`，按 `email + 邮箱凭据` 去重，已存在则跳过 |
| `remark` | 否 | 批次备注 |
| `keyLength` / `keyGroups` | 否 | 卡密随机段长度/段数，默认 5/3 |

> **没有 `credits` 字段**：额度不手填。导入的账号一律记为「待定档」（`credits = 0`），
> 之后由邮箱取件命中额度关键字自动定档（`POST /api/admin/accounts/refresh-status`，`targets: ["credits"]`）。
> 历史请求里携带的 `credits` 会被忽略。

响应：

```json
{
  "batchId": "b_20260211_080000",
  "imported": 98,
  "skipped": 2,
  "failed": 0,
  "cards": ["CARD-XXXXX-XXXXX-XXXXX"],
  "credits": 0,
  "pending": 98,
  "errors": [{ "index": 3, "name": "bad@x.com", "reason": "缺少 access_token" }],
  "samples": [{ "id": 1201, "name": "abc@outlook.com", "cardKey": "CARD-XXXXX-XXXXX-XXXXX" }]
}
```

`pending` = 待定档数量（= `imported`）；`credits` 恒为 0，仅为字段兼容保留。

解析规则（与服务端 `parseAccounts` 对齐）：

1. 输入整体是 JSON：递归找 `accounts` / `account` / `list` / `items` / 裸数组 / 单个对象。
2. 每个对象可能是 **sub2api 账号**（`platform`/`type`/`credentials`）或 **CPA 账号**（`type: "codex"` / `access_token` / `email`）。
3. 逐行 JSONL、或 `卡密导出` 文本中的 JSON 片段也需支持。
4. 必须能取到 `access_token`，否则记为 `failed`。
5. 邮箱取件凭据从 `notes`（JSON 字符串）里的 `mailbox` 段、`extra.mailbox_lookup_name`、或 `邮箱----密码----clientid----refresh_token` 行中提取。
6. 账号名优先取 `credentials.email` → `extra.email` → `name`（截断 `----` 前）→ `email`。

### 3.3 `POST /api/admin/accounts/generate-cards`

为「已导入但缺卡密」的账号补发卡密（一般不需要，导入时已生成）。

```json
{ "ids": [1,2,3], "prefix": "CARD", "regenerate": false }
```

响应 `{ "updated": 3 }`

### 3.4 `PATCH /api/admin/accounts/:id`

```json
{ "remark": "备注", "credits": 200, "banStatus": "banned", "redeemStatus": "unredeemed" }
```

响应：更新后的单个账号对象（同 3.1 items 元素）。

> `credits` 是**兜底纠错通道**（正常流程由取件自动定档，后台 UI 不暴露）。
> 传 `0` 可把账号退回「待定档」，此时该卡不再可兑换。

### 3.5 `POST /api/admin/accounts/batch-delete`

```json
{ "ids": [1,2,3] }
```

响应 `{ "deleted": 3 }`

### 3.6 `POST /api/admin/accounts/:id/copy-card`

前端点「复制卡密」时调用，仅用于记录 `copyCount`，返回完整卡密：

```json
{ "id": 12, "cardKey": "CARD-XXXXX-XXXXX-XXXXX", "copyCount": 3 }
```

### 3.7 `POST /api/admin/accounts/refresh-status`

刷新封禁状态、兑换状态，并可按邮箱取件**自动定档**。两种模式：

**模式 A（指定账号）**

```json
{ "ids": [12, 13], "targets": ["ban", "redeem"] }
```

**模式 B（按筛选条件分批推进）**

```json
{ "filter": { "credits": [0], "banStatus": ["unknown"], "keyword": "" }, "limit": 200, "targets": ["credits"], "cursor": 128 }
```

| 字段 | 说明 |
| --- | --- |
| `targets` | `ban`（封禁）/ `redeem`（兑换）/ `credits`（取件定档）；可多选，`ban` 与 `credits` 共用同一次取件请求 |
| `limit` | 模式 B 单轮最多处理条数，默认 100，最大 500 |
| `cursor` | 只处理 `id > cursor` 的账号；配合响应里的 `nextCursor` 循环调用，直到 `nextCursor` 为 `null`（避免「取件成功但没命中额度」的账号被同一轮反复取件） |
| `filter.credits` | 传 `[0]` 即只处理「待定档」账号 |
| `filter.batchId` | 只处理某个导入批次 |

响应：

```json
{
  "requested": 2,
  "processed": 2,
  "nextCursor": 128,
  "ban": { "banned": 1, "normal": 1, "invalid": 0, "failed": 0 },
  "redeem": { "redeemed": 1, "unredeemed": 1, "failed": 0 },
  "credits": { "hit": 1, "pending": 1, "failed": 0 },
  "items": [
    { "id": 12, "name": "abc@outlook.com", "credits": 40, "creditStatus": "ready", "mailCredits": 1000, "banStatus": "normal", "banReason": null, "redeemStatus": "redeemed", "redeemedAt": "2026-02-11T08:12:33.000Z", "error": null }
  ]
}
```

`ban` / `redeem` / `credits` 三块统计只在对应 `targets` 被请求时返回。

判定规则：

- **封禁状态**：邮箱取件 → 扫描最新 10 封邮件的 `subject + bodyPreview + body`，命中封禁关键词（`account deactivated` / `suspended` / `disabled` / `permanently deleted` / `账户已停用` / `账号已被封禁` 等）→ `banned`；取件成功且未命中 → `normal`；OAuth 换 token 失败（`invalid_grant` / `unauthorized_client`）→ `invalid`（凭据失效，非封禁）；网络错误 → 保持原状态并返回 `error`。
- **额度定档**：同一次取件结果里命中额度关键字（`we've added N credits` / `添加了 N 额度` / `N クレジット` / `N créditos` …）→ 写回 `Account.credits = floor(N ÷ 25)`，计入 `hit`；取件成功但没命中 → 保持原值（导入时为 `0` = 待定档），计入 `pending`；取件失败 → `failed`。**未命中的账号不会被清空已有档位。**
- **兑换状态**：读取账号自身 `access_token` 的 JWT `exp`；若已过期则用 `refresh_token` 向 OpenAI OAuth 端点刷新。刷新成功 → 账户仍活跃，同时把新 `access_token` / `refresh_token` 回写数据库；刷新失败（`invalid_grant`）→ 标记 `invalid` 并计入 `failed`。**账号被他人使用过（`access_token` 与导入时不一致或 `last_refresh` 推进）视为 `redeemed` 并记录 `redeemedAt`。**

### 3.8 `GET /api/admin/accounts/:id/mailbox`

账号取件弹窗数据源：返回该账号的邮箱凭据（脱敏可切换）+ 最新邮件 + 封禁/额度分析。

查询参数：`maxMessages`（默认 10，最大 50）、`refresh`（`1` 时强制重新取件）

```json
{
  "account": {
    "id": 12,
    "name": "abc@outlook.com",
    "email": "abc@outlook.com",
    "credits": 100,
    "cardKey": "CARD-XXXXX-XXXXX-XXXXX",
    "banStatus": "normal",
    "redeemStatus": "unredeemed",
    "createdAt": "2026-02-11T08:00:00.000Z"
  },
  "mailbox": {
    "email": "abc@outlook.com",
    "provider": "outlook",
    "authType": "oauth2",
    "imapHost": "outlook.office365.com",
    "imapPort": 993,
    "password": "jpqxdw31909",
    "clientId": "9e5f94bc-...",
    "refreshToken": "M.C528_BAY...",
    "line": "abc@outlook.com----jpqxdw31909----9e5f94bc-...----M.C528_BAY..."
  },
  "pickup": {
    "ok": true,
    "error": null,
    "banned": false,
    "banReason": null,
    "banKeywords": [],
    "credits": 500,
    "creditsBalance": 20,
    "latestCode": "123456",
    "fetchedAt": "2026-02-11T08:20:00.000Z"
  },
  "messages": [
    {
      "id": "AAMkAD...",
      "subject": "Your OpenAI verification code",
      "from": "OpenAI <noreply@openai.com>",
      "receivedDateTime": "2026-02-11T08:19:00.000Z",
      "isRead": false,
      "bodyPreview": "...",
      "bodyHtml": "<html>...",
      "code": "123456",
      "credits": 500,
      "balance": 20,
      "kind": "code"
    }
  ]
}
```

### 3.9 `POST /api/admin/accounts/export`

按当前筛选导出账号文件。请求同 3.1 的筛选参数 + 格式：

```json
{
  "format": "sub2api",
  "filter": { "credits": [100], "banStatus": ["normal"], "redeemStatus": ["unredeemed"] },
  "ids": null,
  "includeCardKey": true,
  "filename": "accounts-100"
}
```

响应 `text/plain`（`email` 格式）或 `application/json`（`sub2api` / `cpa`），带 `Content-Disposition`。

### 3.10 `GET /api/admin/stats/overview`

后台首页统计：

```json
{
  "accounts": { "total": 1280, "unredeemed": 942, "redeemed": 338, "banned": 12, "invalid": 3, "pending": 96 },
  "cards": { "total": 1280, "redeemed": 338, "unredeemed": 942 },
  "batches": [{ "batchId": "b_20260211_080000", "credits": 0, "count": 100, "createdAt": "2026-02-11T08:00:00.000Z", "remark": "2月批次" }],
  "redeemTrend": [{ "date": "2026-02-11", "count": 12 }],
  "byCredits": [{ "credits": 40, "total": 400, "unredeemed": 300, "redeemed": 100, "banned": 4 }],
  "tiers": [{ "credits": 40, "label": "40 额度", "accounts": 400, "available": 300, "redeemed": 100, "banned": 4, "disabled": 0 }],
  "pending": 96
}
```

批次不再绑定档位（`credits` 恒为 0），额度以账号为准。

### 3.11 卡密管理

- `GET /api/admin/cards` — 同 3.1 分页结构，`items` 元素为 `{ id, cardKey, credits, creditStatus, accountId, accountName, status, redeemStatus, redeemedAt, createdAt, remark }`
- `PATCH /api/admin/cards/:id` — `{ "status": "disabled" | "active", "remark": "..." }`
- `POST /api/admin/cards/batch-disable` — `{ "ids": [1,2] }` → `{ "updated": 2 }`

### 3.12 额度档位（只读派生）

档位不是手工维护的字典：账号导入后由「邮箱取件命中额度关键字」自动定档，后台只能查看分布，**没有新增/删除接口**。

- `GET /api/admin/credit-tiers` →
  ```json
  {
    "items": [
      { "credits": 0,  "label": "待定档",  "accounts": 6,  "available": 0,  "redeemed": 0, "banned": 0, "disabled": 0 },
      { "credits": 40, "label": "40 额度", "accounts": 12, "available": 9,  "redeemed": 3, "banned": 1, "disabled": 0 }
    ],
    "pending": 6,
    "total": 18
  }
  ```
  `available` 仅统计「未兑换 + 未封禁 + 未停用 + 已定档」的账号。

### 3.13 系统设置

- `GET /api/admin/settings` → `{ "siteName": "Cardline", "siteSubtitle": "SECURE DELIVERY", "pickupConcurrency": 4, "pickupMaxMessages": 30, "defaultFormat": "sub2api", "redeemLimitPerCard": 1, "announcement": "" }`
- `PATCH /api/admin/settings` → 部分更新，返回全量设置

---

## 4. 数据模型（SQLite / Prisma）

```prisma
model AdminUser {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  displayName  String   @default("管理员")
  role         String   @default("admin")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Batch {
  id        Int      @id @default(autoincrement())
  batchId   String   @unique          // b_20260211_080000
  credits   Int
  count     Int      @default(0)
  remark    String?
  source    String   @default("paste")
  createdAt DateTime @default(now())
  accounts  Account[]
}

model Account {
  id            Int       @id @default(autoincrement())
  name          String                       // 账号名（一般=邮箱）
  email         String?
  credits       Int                          // 档位：0 = 待定档，>0 = 邮件命中 credits ÷ 25
  cardKey       String    @unique
  planType      String?
  accountId     String?                      // chatgpt_account_id
  userId        String?
  accessToken   String
  refreshToken  String?
  idToken       String?
  sessionToken  String?
  expiresAt     DateTime?
  rawSource     String    @default("sub2api") // sub2api | cpa
  rawJson       String?                       // 原始账号对象（JSON 文本，保真回写）
  banStatus     String    @default("unknown")
  banReason     String?
  banKeywords   String?                       // JSON 数组文本
  banCheckedAt  DateTime?
  redeemStatus  String    @default("unredeemed")
  redeemedAt    DateTime?
  redeemCount   Int       @default(0)
  copyCount     Int       @default(0)
  batchId       String?
  remark        String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  batch     Batch?         @relation(fields: [batchId], references: [batchId])
  mailbox   MailCredential?
  redeemLogs RedeemLog[]
  pickupLogs PickupLog[]

  @@index([credits])
  @@index([banStatus])
  @@index([redeemStatus])
  @@index([email])
}

model MailCredential {
  id           Int      @id @default(autoincrement())
  accountId    Int      @unique
  email        String
  provider     String   @default("outlook")
  authType     String   @default("oauth2")
  password     String?
  clientId     String?
  refreshToken String?
  line         String?                       // 完整四段式凭据行
  imapHost     String?
  imapPort     Int?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  account      Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
}

model RedeemLog {
  id          Int      @id @default(autoincrement())
  cardKey     String
  accountId   Int?
  credits     Int
  format      String
  ip          String?
  userAgent   String?
  success     Boolean  @default(true)
  message     String?
  createdAt   DateTime @default(now())
  account     Account? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  @@index([cardKey])
}

model PickupLog {
  id        Int      @id @default(autoincrement())
  accountId Int
  email     String
  ok        Boolean
  banned    Boolean  @default(false)
  credits   Int?
  code      String?
  error     String?
  createdAt DateTime @default(now())
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}

model CreditTier {
  id      Int    @id @default(autoincrement())
  credits Int    @unique
  label   String
  sort    Int    @default(0)
}

model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

---

## 5. 卡密规则

- 格式：`<PREFIX>-<G1>-<G2>-<G3>`，默认 `CARD-XXXXX-XXXXX-XXXXX`
- 字符集：`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉易混 `I O 0 1`）
- 生成时校验数据库唯一性，冲突重试
- 卡密与账号是 1:1（一个账号一张卡）
- 卡密状态：`active` / `disabled`（存 `Account.cardDisabled` 或独立 Card 表亦；实现上以 Account 为准即可，接口 3.11 由 Account 映射）

---

## 6. 邮箱取件实现要点（官方直连）

```
TOKEN_URL    = https://login.microsoftonline.com/consumers/oauth2/v2.0/token
MESSAGES_URL = https://outlook.office.com/api/v2.0/me/messages
SCOPE        = https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/Mail.ReadWrite offline_access
```

1. `POST TOKEN_URL`，`application/x-www-form-urlencoded`，字段 `grant_type=refresh_token&client_id=..&refresh_token=..&scope=..`，超时 30s。
2. `GET MESSAGES_URL?$top=10&$orderby=ReceivedDateTime desc&$select=Id,Subject,From,ReceivedDateTime,BodyPreview,Body,IsRead`，头 `Authorization: Bearer <at>`、`Prefer: outlook.body-content-type=html`。
3. 把 PascalCase 响应映射成 Graph 风格 camelCase。
4. 验证码提取：先按上下文锚点 `(验证码|校验码|code|verification(\s+code)?|one-time password)[^0-9]{0,45}(\d{4,8})`，再在 60 字上下文内找 6 位数字，兜底取第一个 6 位数字。
5. **额度提取（= 账号档位的唯一来源）**：多语言关键词（`we've added N credits` / `添加了 N 额度` / `N クレジット` / `N créditos` / `N credits vào` 等）命中后取 `N`：
   - 展示用余额 `balance = N / 25`
   - **账号档位 `credits = floor(N / 25)`**，命中即写回 `Account.credits`；没命中保持原值（导入时为 `0` = 待定档，不进兑换池）
   - 进制常量在 `apps/server/src/common/credits.ts`（`CREDITS_PER_TIER = 25`），前后台共用
6. 封禁关键词：`account deactivated|suspended|disabled|permanently deleted|账户已停用|账号已封禁|帳號已停用` 等。
7. 并发 4，`Promise.all` worker 池；失败不阻塞其它账号。
