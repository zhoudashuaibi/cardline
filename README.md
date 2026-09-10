# Cardline · 卡密兑换 / 邮箱取件系统

输入卡密 → 校验 → 按所选格式生成交付文件；配套邮箱取件与后台账号管理。

- **前台卡密兑换页** `/` — 粘贴卡密、选择交付格式（`sub2api` / `CPA` / `邮箱 TXT`）、生成并下载交付文件
- **前台邮箱取件页** `/pickup` — 输入卡密 / 邮箱 / `邮箱----密码----clientid----refresh_token` 凭据行，或上传 txt / sub2api JSON 文件取件，自动提取验证码、额度、封禁状态
- **后台管理系统** `/admin` — 账号列表（额度、封禁、兑换状态筛选与排序）、批量导入切割、卡密生成、复制卡密、一键取件弹窗
- **额度全自动**：账号额度不手填，只认邮箱取件命中的额度关键字（档位 = 命中 credits ÷ 25）；未命中的账号为「待定档」，不进兑换池

技术栈：**NestJS + Prisma + SQLite** / **React 18 + Ant Design 5 + Ant Design Pro 组件 + Vite**

---

## 一、Docker 部署

镜像由 **GitHub Actions 构建并推送到 GHCR**：`ghcr.io/zhoudashuaibi/cardline-server` 和 `ghcr.io/zhoudashuaibi/cardline-web`。推送代码到 GitHub 即自动发布（默认分支打 `latest`，同时打分支名、tag、`sha-xxxxxxx` 标签）。

### 方式 A：服务器只拉镜像运行（推荐）

```bash
# 1. 准备环境变量（可选，不建也能跑）
cp .env.docker.example .env

# 2. 登录 GHCR（镜像若已设为 public 可跳过这步）
#    PAT 需要勾选 read:packages 权限
echo <你的PAT> | docker login ghcr.io -u zhoudashuaibi --password-stdin

# 3. 拉取并启动（--no-build 确保只拉取、不在服务器上重新构建）
docker compose pull
docker compose up -d --no-build
```

### 方式 B：源码本地构建

```bash
docker compose up -d --build     # 构建 + 启动
```

启动后访问：

| 地址 | 说明 |
| --- | --- |
| http://localhost:3010/ | 前台卡密兑换页 |
| http://localhost:3010/pickup | 前台邮箱取件页 |
| http://localhost:3010/admin | 后台管理系统 |

> 部署到服务器时把 `localhost` 换成服务器 IP（或域名）。端口默认 **3010**，要改就在 `.env` 里设 `WEB_PORT`。

默认后台账号 **admin / admin123**（首次启动自动创建，请在 `.env` 里改 `ADMIN_PASSWORD` 后重建，或登录后到「系统设置 → 修改密码」修改）。

常用命令：

```bash
docker compose pull      # 拉取 GHCR 上的最新镜像
docker compose up -d     # 启动（本地无镜像时会构建）
npm run docker:logs      # 跟随日志
npm run docker:down      # 停止
npm run docker:rebuild   # 本机无缓存重建
```

> 注意：`docker compose pull` 只能拉取**已经推送到仓库**的镜像。本项目默认走 GHCR，所以拉取前要确保 CI 已经跑完推送成功；如果镜像还是私有包，必须先 `docker login ghcr.io`，否则会报 `denied` / `unauthorized`。

### 部署说明

- **架构**：`web` 容器（nginx）托管前端静态文件并把 `/api` 反向代理到 `server` 容器（NestJS，3000 端口）。对外只暴露一个端口，无跨域问题。
- **数据持久化**：SQLite 数据库位于命名卷 `cardline-data` 的 `/data/cardline.db`，容器重建不丢数据。
- **表结构自动初始化**：`server` 容器启动时执行 `apps/server/scripts/bootstrap-db.js`（幂等 `CREATE TABLE IF NOT EXISTS`），无需 Prisma CLI，也不需要手工迁移。
- **后端地址可配**：nginx 通过 `CARDLINE_API_UPSTREAM`（默认 `server:3000`）反代，改成 `host.docker.internal:3000` 之类即可指向外部后端。
- **备份**：`docker run --rm -v cardline-data:/data -v %cd%:/backup alpine tar czf /backup/cardline-backup.tar.gz -C /data .`
- **改端口**：`.env` 里设 `WEB_PORT`（默认 `3010`，例如 `WEB_PORT=80` 走标准 HTTP 端口）。
- **换镜像来源**：`.env` 里设 `CARDLINE_REGISTRY`（默认 `ghcr.io/zhoudashuaibi`）与 `CARDLINE_TAG`（默认 `latest`，生产建议固定成 `sha-xxxxxxx`）。
- **直接暴露 API**：取消 `docker-compose.yml` 中 `server.ports` 的注释。

### 镜像体积

| 镜像 | 大小 | 说明 |
| --- | --- | --- |
| `ghcr.io/zhoudashuaibi/cardline-server` | ~646 MB | node:22-bookworm-slim + NestJS + Prisma 引擎 |
| `ghcr.io/zhoudashuaibi/cardline-web` | ~75 MB | nginx:alpine + 静态资源 |

### 单容器运行（不用 compose）

```bash
docker build -f docker/Dockerfile.server -t cardline-server .
docker run -d --name cardline-server -p 3000:3000 \
  -e JWT_SECRET=your-secret -e ADMIN_PASSWORD=your-password \
  -v cardline-data:/data cardline-server

docker build -f docker/Dockerfile.web -t cardline-web .
docker run -d --name cardline-web -p 3010:80 --link cardline-server:server cardline-web
```

---

## 二、本地开发

```bash
npm install          # 一次装完前后端（npm workspaces）
npm run dev          # 同时启动后端(3000) + 前端(5173)
```

- 前端 http://localhost:5173/ ，`/admin` 进后台，`/api` 由 Vite 代理到后端
- 数据库文件 `apps/server/prisma/cardline.db`，**首次启动自动建表并写入种子数据**，无需手动迁移
- 想用 Prisma 的迁移/可视化：`npm run db:push`、`npm run db:studio`

### 全部脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 前后端一起开发模式启动 |
| `npm run build` | 编译后端 + 构建前端 |
| `npm start` | 只启动已编译的后端 |
| `npm run db:push` | Prisma 同步表结构 |
| `npm run db:studio` | Prisma Studio 可视化数据库 |
| `npm run test:convert` | 格式转换回归测试（10 项） |
| `npm run test:smoke` | 端到端接口联调测试（85 项，需后端已启动） |

### 脱敏样例

`samples/` 下有可直接导入体验的样例文件，**所有 token / 密码 / ID 都是占位值**，可安全入库：

| 文件 | 说明 |
| --- | --- |
| `samples/sub2api.sample.json` | 2 个账号的 sub2api 完整导出包（含 `notes.mailbox` 邮箱取件凭据） |
| `samples/cpa.sample.json` | 1 个账号的 CPA / Codex auth JSON |

重新生成：`npm run make-samples --workspace @cardline/server`

> 你自己的真实账号 JSON（如 `sub2api_格式参考.json`）已被 `.gitignore` 排除，**不会**进入版本库；相关测试在文件不存在时会自动跳过。

---

## 三、功能说明

### 3.1 交付格式（只有三种）

| 格式 | 产物 | 内容 |
| --- | --- | --- |
| `sub2api` | `<卡密>.sub2api.json` | `{ type: "sub2api-data", version, exported_at, proxies, accounts[] }`，每个账号含 `credentials`，并在 `notes` 里保留邮箱取件凭据 |
| `cpa` | `<卡密>.cpa.json` | `{ type: "codex", access_token, id_token, refresh_token, email, account_id, plan_type, expired }`；单账号输出对象，多账号输出数组。来源有 `extra` 时随产物带上（见下） |
| `email` | `<卡密>.txt` | 每行 `邮箱----密码----clientid----refresh_token` |

**批量下载（兑换页底部按钮）**：多张卡密一次兑换后，逐卡下载拿到的是 N 份独立文件；批量按钮按格式给不同的东西：

| 格式 | 批量产物 |
| --- | --- |
| `sub2api` | **一份** `cardline-sub2api-<时间戳>.json`，所有成功账号进同一个 `accounts` 数组（与 `sub2api_格式参考.json` 同构），失败卡密不写入 |
| `cpa` | **一个 zip** `cardline-cpa-<时间戳>.zip`，里面每张卡密一个独立的 `.cpa.json`（裸 Codex auth，形同 `samples/cpa.sample.json`）。CPA 不做合并：下游要的就是一个个独立文件 |
| `email` | **一份** `cardline-email-<时间戳>.txt`，所有凭据行直接拼接，不带任何 `===== 卡密 =====` 分隔标题 |

`sub2api ⇄ CPA` 双向无损转换，逻辑对齐 [convert.13916454.xyz](https://convert.13916454.xyz/)：缺少真实 `id_token` 时按 CPA 规则构造 Codex 可解析的占位 JWT（`id_token_synthetic: true`）。**只做转换，不做测活。**

**导入的字段会跟着账号一起交付**：`extra` 整个透传（`auth_provider`、`privacy_mode`、`openai_*`、`two_factor_enabled` / `two_factor_status` / `two_factor_error` …，含空串原样保留），`concurrency` / `priority` / `rate_multiplier` / `auto_pause_on_expired` / `group_ids` 也按导入值输出，不会被默认值顶掉；`notes` 里的 `mailbox` 与 `two_factor.secret` 段原样保留。导入时这些字段存在数据库 `rawJson` 里，兑换下载与后台导出都从它还原。

**CPA 与 2FA**：CPA 产物主体仍是 Codex CLI 直读的 `auth.json`（`type: "codex"` + `access_token` / `id_token` …），在此之上追加一个 `extra`，把导入时的附加字段原样带上 —— 这是 `cpa_格式参考.json` 里放 2FA 标记的位置：

- 带上：`two_factor_enabled` / `two_factor_status` / `two_factor_error` 等**标记**，以及 `auth_provider` / `privacy_mode` / `openai_*`（来源 `extra` 里有什么就带什么，一个键不加不减）
- 不带：TOTP **密钥**。密钥在 sub2api 的 `notes.two_factor.secret` 里，CPA 没有 `notes` 字段位，本实现也不会把它塞进 `extra`；服务端补充键（`email_key` / `name` / 手工拼的 `mailbox_*`）同样不写入 CPA
- 来源没有 `extra` 时（例如裸 Codex auth 导入的账号），产物不写 `extra`，形态与以前完全一致

> Codex CLI 读取 `auth.json` 时只认它自己需要的键，多余的 `extra` 会被忽略；如果你的下游对未知字段做严格校验，请在设置里改用 `sub2api` 格式交付 2FA 信息。

### 3.2 卡密规则

- 格式 `CARD-XXXXX-XXXXX-XXXXX`，字符集去掉易混的 `I O 0 1`
- 一个账号一张卡，前缀/段数/段长可在导入时自定义
- 首次兑换使用原子更新锁定账号（`unredeemed → redeemed`），之后重复提交只切换格式重新导出，不会多消耗账号
- 卡密可在后台「卡密管理」停用

### 3.3 后台账号列表

- 列：`id`、账号名、**额度（档位）**、卡密、导入时间、封禁状态（已封禁 + 封禁时间 + 原因）、兑换状态（已兑换 + 兑换时间）
- 全部列可排序；顶部筛选：**额度筛选（含「待定档」）/ 封禁状态筛选 / 兑换状态筛选**，另有卡密、关键词搜索
- **取件定档**按钮：对「待定档」账号逐个取件，命中额度关键字后自动写回档位（可循环跑完整批）
- **刷新状态**按钮：勾选「刷新封禁状态 / 刷新兑换状态 / 取件定档」，范围可选「选中的 N 条」或「按当前筛选条件」
  - 封禁状态：官方直连取件 → 扫描最新邮件里的封禁关键词（`account deactivated` / `suspended` / `已停用` / `账号已封禁` …）
  - 兑换状态：校验账号 `access_token` / `refresh_token`；token 已被轮换说明账号已被使用
- 操作列：**复制卡密**（记录复制次数）、**取件**（弹窗显示该账号邮箱取件列表与详情，命中额度即定档）、编辑备注、删除
- 列表支持导出为 `sub2api` / `CPA` / `邮箱 TXT`

### 3.4 额度档位（全自动，不用手填）

**账号额度只来自邮箱取件命中的额度关键字**，后台不提供手工填写或手工建档位：

- 档位 = 邮件命中的原始 credits ÷ **25**（向下取整），例如 `we've added 1000 credits` → 档位 `40`
- 导入时账号先落 **「待定档」（credits = 0）**，随后由取件定档；未命中的账号保持待定档
- **待定档账号不进兑换池**：用它的卡密兑换会返回 `CREDITS_PENDING`，也不会被同档位补货选中
- 后台「额度档位」页是**只读**的分布表（档位 / 账号数 / 可售 / 已兑换 / 已封禁），由账号实际额度聚合派生

### 3.5 批量导入

粘贴 JSON 或上传文件（`.json` / `.txt` / `.jsonl`，支持多文件、支持卡密导出 TXT 里的 JSON 片段），**不需要选额度**：

1. 从 `accounts[]` / 裸数组 / JSONL 中切割出一个个账号
2. 自动提取邮箱取件凭据（`notes.mailbox`、`extra.mailbox_lookup_name`、`邮箱----密码----clientid----refresh_token`）
3. 按 `前缀 + 段数/段长` 为每个账号生成卡密，额度记为「待定档」
4. 可开启「跳过重复账号」，重复导入幂等
5. 勾选「导入后自动取件定档」（默认开）：导入返回后前端自动接着跑批量取件，命中额度即定档
6. 返回导入数量、跳过数量、失败原因、待定档数量、生成结果（可一键复制全部卡密）

### 3.5 邮箱取件（官方直连，无第三方中转）

```
TOKEN_URL    = https://login.microsoftonline.com/consumers/oauth2/v2.0/token
MESSAGES_URL = https://outlook.office.com/api/v2.0/me/messages
SCOPE        = IMAP.AccessAsUser.All + Mail.ReadWrite + offline_access
```

- 用 `client_id` + `refresh_token` 直连微软换 token，再读 Outlook 收件箱
- 并发 4，单账号超时 30s，最多取最新 10 封（可配）
- **一次取多个邮箱**：结果区顶部有邮箱切换条（`共 N 个邮箱 · 当前第 M 个`），左侧邮件列表只显示当前邮箱的邮件，点邮箱名即切换；只有一个邮箱时不显示切换条
- 智能提取：验证码（多语言上下文锚点）、额度（`we've added N credits` / `添加了 N 额度` / `N クレジット` / `N créditos` 等，余额 = credits ÷ 25）、封禁关键词
- 邮件正文经服务端净化（去 `<script>`、`on*` 事件、非法 `src`/`href`）后放进 `sandbox=""` iframe 渲染

---

## 四、目录结构

```
卡密兑换/
├── .github/workflows/ci.yml        # CI：构建 + 测试 + 推送 Docker 镜像到 GHCR
├── apps/
│   ├── server/                     # NestJS 后端
│   │   ├── prisma/schema.prisma    # 数据模型
│   │   ├── scripts/
│   │   │   ├── bootstrap-db.js     # 幂等建表（Docker/本地均可）
│   │   │   ├── make-samples.js     # 生成脱敏样例
│   │   │   ├── smoke-test.js       # 端到端接口测试
│   │   │   └── page-check.js       # CDP 无依赖页面巡检/流程脚本
│   │   ├── test/convert.test.js    # 格式转换回归测试
│   │   └── src/
│   │       ├── accounts/           # 账号管理 + 导入 + 状态刷新
│   │       ├── admin/              # 卡密管理 / 额度档位 / 设置 / 概览
│   │       ├── auth/               # 后台登录鉴权（JWT）
│   │       ├── convert/            # sub2api ⇄ CPA ⇄ 邮箱 TXT
│   │       ├── mailbox/            # 官方直连取件 + 验证码/额度/封禁分析
│   │       ├── public/             # 前台兑换 / 取件接口
│   │       ├── settings/           # 系统设置
│   │       └── prisma/             # PrismaService + 建表语句
│   └── web/                        # React 前端（前台 + 后台）
│       └── src/
│           ├── api/                # 接口封装与类型
│           ├── pages/              # RedeemPage / PickupPage / admin/*
│           └── components/         # 公共组件（含 MailBrowser 邮件浏览）
├── docker/
│   ├── Dockerfile.server
│   ├── Dockerfile.web
│   ├── nginx.conf.template
│   └── entrypoint.sh
├── docker-compose.yml
├── docs/API.md                     # 完整接口契约
├── samples/                        # 脱敏样例（可安全入库）
└── .env.docker.example
```

---

## 五、常见问题

**Q：导入时提示「未解析出任何账号」？**
A：确认 JSON 里每个账号对象都含 `access_token`（sub2api 的 `credentials.access_token` 或 CPA 的 `access_token`）。接口错误的详情会在返回的 `errors` 数组里给出每条原因。

**Q：导入时为什么没有额度可以填？账号额度是怎么来的？**
A：额度不手填，也不手工建档位。导入的账号先记为「待定档」（`credits = 0`），随后由邮箱取件扫描最新邮件，命中额度关键字（`we've added N credits` / `添加了 N 额度` / `N クレジット` / `N créditos` …）就自动定档：**档位 = N ÷ 25**。导入弹窗默认勾选「导入后自动取件定档」，也可以随时在账号列表点「取件定档」重跑。

**Q：兑换报 `CREDITS_PENDING`（额度待定）？**
A：该卡密对应账号还没从邮件里定出额度（未取件 / 取件成功但没命中额度关键字），因此不进兑换池。到后台账号列表按「待定档」筛选，点「取件定档」重试；若邮箱里确实没有额度邮件，该账号无法自动定档。

**Q：取件报「换 token 失败（invalid_grant）」？**
A：该邮箱的 `refresh_token` 已失效或被撤销。系统会把账号标记为「凭据失效」（区别于「已封禁」）。

**Q：刷新兑换状态一直失败？**
A：兑换状态依赖 `refresh_token` 向 OpenAI 换 token 来判定；如果账号没有 `refresh_token`，只能依据 `access_token` 是否过期判断，接口会返回明确提示。

**Q：Docker 里改了 `.env` 不生效？**
A：`.env` 是 compose 的变量来源，改完执行 `docker compose up -d`（必要时 `--force-recreate`）。

**Q：`docker compose pull` 报 `not found`？**
A：说明要去拉的那个名字在仓库里不存在。跑 `docker compose config | findstr image` 确认 compose 实际解析出的完整镜像名（应形如 `ghcr.io/zhoudashuaibi/cardline-server:latest`）。如果名字不带仓库前缀，Docker 会默认去 `docker.io/library/` 找，必然 `not found`。

**Q：`docker compose pull` 报 `denied` / `unauthorized`？**
A：GHCR 上的包默认是私有的。要么 `docker login ghcr.io -u <用户名> -p <带 read:packages 的 PAT>`，要么到 GitHub → 你的 Packages → 该包 → Package settings → Change visibility 改成 public。

**Q：CI 里 Docker 那步成功了，为什么还是拉不到镜像？**
A：看 workflow 的 `push` 参数。`push: false` 只在 runner 上构建验证，job 结束镜像就随 runner 销毁，不会发布到任何仓库；必须 `push: true` 且先 `docker/login-action` 登录，镜像才会有地方可拉。

**Q：想换数据库？**
A：改 `apps/server/prisma/schema.prisma` 的 `datasource`（如 `mysql`），配置 `DATABASE_URL`，然后 `npm run db:push`。注意：SQLite 专用的自举建表语句只在 SQLite 下生效，换库后请用 Prisma 迁移。
