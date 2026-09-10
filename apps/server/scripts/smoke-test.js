#!/usr/bin/env node
/**
 * 端到端冒烟测试：登录 → 导入账号（待定档）→ 待定档拦截兑换 → 定档 → 兑换 → 交付文件校验 → 导出 → 统计
 * 用法：node scripts/smoke-test.js [apiBase] [sampleJsonPath] [credits]
 *
 * 说明：额度不再由导入入参决定，而是邮箱取件命中额度关键字后自动得出
 * （档位 = 命中 credits ÷ 25）。测试环境没有真实邮箱额度邮件，
 * 因此用 `PATCH /admin/accounts/:id { credits }` 这个兜底通道模拟「取件已定档」。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.argv[2] || 'http://127.0.0.1:3000/api';

/**
 * 样例文件解析：
 *  1. 命令行显式指定
 *  2. 真实参考资料（含真实凭据，已被 .gitignore 排除，本地才有）
 *  3. 脱敏样例 samples/sub2api.sample.json（CI / 克隆仓库后可用）
 */
function resolveSample() {
  if (process.argv[3]) return process.argv[3];
  const root = path.join(__dirname, '..', '..', '..');
  const candidates = [
    path.join(root, 'sub2api_格式参考.json'),
    path.join(root, 'samples', 'sub2api.sample.json'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

const SAMPLE = resolveSample();
const CREDITS = Number(process.argv[4] || 100);

let token = '';
let passed = 0;
let failed = 0;

function ok(label, detail = '') {
  passed++;
  console.log(`  \u2714 ${label}${detail ? ` — ${detail}` : ''}`);
}

function bad(label, detail = '') {
  failed++;
  console.log(`  \u2716 ${label}${detail ? ` — ${detail}` : ''}`);
}

function assert(condition, label, detail = '') {
  if (condition) ok(label, detail);
  else bad(label, detail);
}

async function call(method, path, body, options = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（导出接口） */
  }
  if (!response.ok && !options.allowFailure) {
    throw new Error(`${method} ${path} → HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** 用兑换接口拿到一份真实的 sub2api 交付 JSON，用于测试「上传文件解析」 */
async function sampleAccountJson(callFn, cardKey) {
  const redeemed = await callFn('POST', '/public/redeem', { cards: [cardKey], format: 'sub2api' });
  return JSON.parse(redeemed.json.results[0].content);
}

async function main() {
  console.log(`\n=== 卡密兑换系统 E2E 冒烟测试 ===\nAPI: ${API}\n`);

  // -------------------------------------------------------------------------
  console.log('[1] 公共元信息');
  const meta = await call('GET', '/public/meta');
  assert(meta.json?.siteName === 'Cardline', '站点信息读取正常', meta.json?.siteName);
  assert(meta.json?.formats?.length === 3, '交付格式为 3 种', meta.json?.formats?.map((f) => f.value).join(', '));
  assert(
    Array.isArray(meta.json?.creditTiers),
    '在售档位由账号派生（无手工档位表）',
    `creditTiers=${JSON.stringify(meta.json?.creditTiers)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n[2] 后台登录');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.json?.token || '';
  assert(Boolean(token), '登录成功并拿到 token');
  const badLogin = await call('POST', '/auth/login', { username: 'admin', password: 'wrong' }, { allowFailure: true });
  assert(badLogin.status === 401, '错误密码返回 401', String(badLogin.status));
  const savedToken = token;
  token = '';
  const noAuth = await call('GET', '/admin/accounts', undefined, { allowFailure: true });
  assert(noAuth.status === 401, '未鉴权访问后台返回 401', String(noAuth.status));
  token = savedToken;

  // -------------------------------------------------------------------------
  console.log('\n[3] 导入账号（真实 sub2api 样例，额度不手填）');
  if (!fs.existsSync(SAMPLE)) {
    bad('样例文件存在', SAMPLE);
  } else {
    const content = fs.readFileSync(SAMPLE, 'utf8');
    const bytes = Buffer.byteLength(content);
    console.log(`    样例：${path.basename(SAMPLE)} (${(bytes / 1024).toFixed(1)} KB)`);
    const imported = await call('POST', '/admin/accounts/import', {
      content,
      prefix: 'CARD',
      remark: '冒烟测试批次',
      skipDuplicate: true,
      source: 'paste',
    });
    assert(
      imported.json?.imported > 0 || imported.json?.skipped > 0,
      '导入接口可用',
      `imported=${imported.json?.imported}, skipped=${imported.json?.skipped}`,
    );
    assert(imported.json?.failed === 0, '没有失败项', `failed=${imported.json?.failed}`);
    assert(
      imported.json?.pending === imported.json?.imported,
      '导入的账号全部记为待定档',
      `pending=${imported.json?.pending}, imported=${imported.json?.imported}`,
    );
    if (imported.json?.imported > 0) {
      assert(
        Array.isArray(imported.json?.cards) && imported.json.cards.length === imported.json.imported,
        '每个账号都生成了卡密',
        `${imported.json?.cards?.length} 张`,
      );
    }
    if (imported.json?.samples?.[0]) {
      console.log(`    样例卡密：${imported.json.samples[0].cardKey}  ←  ${imported.json.samples[0].name}`);
    }
    const dup = await call('POST', '/admin/accounts/import', {
      content,
      skipDuplicate: true,
      source: 'paste',
    });
    assert(dup.json?.skipped > 0 && dup.json?.imported === 0, '重复导入被完全跳过', `skipped=${dup.json?.skipped}`);
  }

  // -------------------------------------------------------------------------
  console.log('\n[4] 账号列表：分页 / 筛选 / 排序');
  const list = await call('GET', `/admin/accounts?page=1&pageSize=5&sortField=createdAt&sortOrder=descend`);
  assert(list.json?.items?.length > 0, '列表返回数据', `total=${list.json?.total}`);
  const first = list.json.items[0];
  for (const field of ['id', 'name', 'credits', 'cardKey', 'createdAt', 'banStatus', 'redeemStatus']) {
    assert(first[field] !== undefined && first[field] !== null, `字段存在：${field}`, String(first[field]).slice(0, 48));
  }
  assert(first.hasMailbox === true, '解析出邮箱取件凭据');
  assert(first.creditStatus === 'pending' && first.credits === 0, '新导入账号为待定档', `creditStatus=${first.creditStatus}`);

  const pendingFilter = await call('GET', '/admin/accounts?credits=0&pageSize=5');
  assert(
    pendingFilter.json?.items?.length > 0 && pendingFilter.json.items.every((row) => row.credits === 0),
    '待定档筛选生效',
    `total=${pendingFilter.json?.total}`,
  );
  assert(pendingFilter.json?.summary?.pending > 0, '汇总里给出待定档数量', `pending=${pendingFilter.json?.summary?.pending}`);

  const byCredits = await call('GET', '/admin/accounts?credits=999999&pageSize=3');
  assert(byCredits.json?.items?.length === 0, '不存在的额度返回空');

  const asc = await call('GET', '/admin/accounts?pageSize=3&sortField=id&sortOrder=ascend');
  const desc = await call('GET', '/admin/accounts?pageSize=3&sortField=id&sortOrder=descend');
  assert(asc.json.items[0].id < desc.json.items[0].id, '排序参数生效', `asc=${asc.json.items[0].id} desc=${desc.json.items[0].id}`);

  const keyword = await call('GET', `/admin/accounts?keyword=${encodeURIComponent(first.cardKey)}&pageSize=3`);
  assert(keyword.json?.items?.length === 1, '按卡密搜索命中唯一账号');

  // -------------------------------------------------------------------------
  console.log('\n[4.1] 待定档账号不进兑换池');
  const pendingRedeem = await call('POST', '/public/redeem', { cards: [first.cardKey], format: 'sub2api' });
  assert(
    pendingRedeem.json?.results?.[0]?.code === 'CREDITS_PENDING',
    '待定档卡密兑换被拒绝',
    pendingRedeem.json?.results?.[0]?.message,
  );

  const metaPending = await call('GET', '/public/meta');
  assert(
    !metaPending.json?.creditTiers?.includes(0),
    '对外档位里不出现待定档',
    JSON.stringify(metaPending.json?.creditTiers),
  );

  // -------------------------------------------------------------------------
  console.log('\n[4.2] 定档（模拟取件命中额度：档位 = 命中 credits ÷ 25）');
  const tiered = await call('PATCH', `/admin/accounts/${first.id}`, { credits: CREDITS });
  assert(tiered.json?.credits === CREDITS, '兜底通道写回档位成功', `credits=${tiered.json?.credits}`);
  assert(tiered.json?.creditStatus === 'ready', '账号状态变为已定档');

  const tiers = await call('GET', '/admin/credit-tiers');
  assert(tiers.json?.items?.length > 0, '额度档位可读（派生）', `${tiers.json?.items?.length} 个`);
  assert(
    tiers.json.items.some((item) => item.credits === CREDITS && item.available >= 1),
    '新档位出现在分布里',
    JSON.stringify(tiers.json.items.find((item) => item.credits === CREDITS)),
  );
  assert(
    tiers.json.items.every((item) => item.id === undefined),
    '档位不再是手工维护的记录（无 id 字段）',
  );

  const filtered = await call('GET', `/admin/accounts?credits=${CREDITS}&redeemStatus=unredeemed&pageSize=3`);
  assert(filtered.json?.items?.length > 0, '额度+状态筛选生效', `total=${filtered.json?.total}`);
  assert(filtered.json.items.every((row) => row.credits === CREDITS), '筛选结果额度正确');

  // -------------------------------------------------------------------------
  console.log('\n[5] 复制卡密');
  const copy = await call('POST', `/admin/accounts/${first.id}/copy-card`);
  assert(copy.json?.cardKey === first.cardKey, '复制卡密接口返回完整卡密');
  assert(copy.json?.copyCount >= 1, '复制次数已记录', `copyCount=${copy.json?.copyCount}`);

  // -------------------------------------------------------------------------
  console.log('\n[6] 前台兑换（三种交付格式）');
  for (const format of ['sub2api', 'cpa', 'email']) {
    const redeem = await call('POST', '/public/redeem', { cards: [first.cardKey], format, limit: 1 });
    const result = redeem.json?.results?.[0];
    assert(result?.ok === true, `兑换成功（${format}）`, result?.message);
    assert(Boolean(result?.content), `返回交付内容（${format}）`, `${result?.filename} ${result?.content?.length} 字节`);
    assert(
      result?.filename === (format === 'email' ? `${first.cardKey}.txt` : `${first.cardKey}.${format}.json`),
      `交付文件名带格式（${format}）`,
      result?.filename,
    );

    if (format === 'email') {
      const lines = String(result.content).trim().split('\n');
      assert(lines[0].split('----').length >= 4, '邮箱 TXT 为四段式凭据行', lines[0].slice(0, 70));
    } else {
      const parsed = JSON.parse(result.content);
      if (format === 'sub2api') {
        assert(parsed.type === 'sub2api-data' && Array.isArray(parsed.accounts), 'sub2api 文档结构正确', `accounts=${parsed.accounts.length}`);
        const account = parsed.accounts[0];
        assert(Boolean(account.credentials?.access_token), 'sub2api credentials.access_token 存在');
        assert(Boolean(account.notes), 'sub2api notes 保留了邮箱取件凭据');
        const notes = JSON.parse(account.notes);
        assert(Boolean(notes.mailbox?.refresh_token), 'notes.mailbox.refresh_token 存在');
        assert(Boolean(notes.mailbox?.source_line), 'notes.mailbox.source_line 存在');
        assert(Boolean(notes.two_factor?.secret), 'notes.two_factor.secret（2FA 密钥）保留', notes.two_factor?.secret ? '有' : '缺');
        assert(account.extra?.two_factor_status === 'enabled', 'extra.two_factor_status 保留', JSON.stringify(account.extra?.two_factor_status));
        assert(account.extra?.two_factor_enabled === true, 'extra.two_factor_enabled 保留');
        assert('two_factor_error' in (account.extra || {}), 'extra 空串字段也原样保留', JSON.stringify(Object.keys(account.extra || {})));
        assert(Boolean(account.extra?.auth_provider), 'extra.auth_provider 保留');
        assert(account.extra?.privacy_mode === 'training_off', 'extra.privacy_mode 保留');
        assert(account.rate_multiplier === 1, 'rate_multiplier 不丢', String(account.rate_multiplier));
      } else {
        assert(parsed.type === 'codex', 'CPA 文档 type=codex');
        assert(Boolean(parsed.access_token), 'CPA access_token 存在');
        assert(parsed.id_token?.split('.').length === 3, 'CPA id_token 为三段式 JWT');
        assert(parsed.extra?.two_factor_status === 'enabled', 'CPA extra.two_factor_status 保留', JSON.stringify(parsed.extra?.two_factor_status));
        assert(parsed.extra?.two_factor_enabled === true, 'CPA extra.two_factor_enabled 保留');
        assert(parsed.extra?.auth_provider !== undefined, 'CPA extra 其余字段一并透传');
        assert(parsed.notes === undefined, 'CPA 不带 notes（TOTP 密钥不外带）');
      }
    }
  }

  const repeat = await call('POST', '/public/redeem', { cards: [first.cardKey], format: 'sub2api', limit: 1 });
  assert(repeat.json?.results?.[0]?.ok === true, '同一卡密可重复导出');
  assert(repeat.json?.results?.[0]?.firstRedeem === false, '重复兑换不再消耗新账号');

  const badCard = await call('POST', '/public/redeem', { cards: ['CARD-AAAAA-BBBBB-CCCCC'], format: 'sub2api' });
  assert(badCard.json?.results?.[0]?.code === 'CARD_INVALID', '不存在的卡密返回 CARD_INVALID');

  const mixed = await call('POST', '/public/redeem', {
    cards: `${first.cardKey}\nCARD-ZZZZZ-ZZZZZ-ZZZZZ`,
    format: 'cpa',
  });
  assert(mixed.json?.summary?.success === 1 && mixed.json?.summary?.failed === 1, '成功/失败结果分开统计');

  // 批量交付：sub2api / email 合并成一份；CPA 没有合并形态（前台走 zip 打包）
  const merged = JSON.parse(mixed.json?.mergedContent ?? 'null');
  assert(merged === null, 'CPA 不返回合并文档（前台打包 zip，每张卡一个文件）', JSON.stringify(mixed.json?.mergedContent)?.slice(0, 40));

  const twoCards = `${first.cardKey}\n${first.cardKey}`;
  const subMerged = await call('POST', '/public/redeem', { cards: twoCards, format: 'sub2api' });
  const parsedSubMerged = JSON.parse(subMerged.json?.mergedContent ?? 'null');
  assert(parsedSubMerged?.type === 'sub2api-data', 'sub2api 合并文档仍是单份 sub2api 文档');
  assert(Array.isArray(parsedSubMerged?.accounts) && parsedSubMerged.accounts.length >= 1, '合并文档含账号');

  const noSuccess = await call('POST', '/public/redeem', { cards: ['CARD-AAAAA-BBBBB-CCCCC'], format: 'sub2api' });
  assert(noSuccess.json?.mergedContent === null, '全部失败时不给合并文件');

  // -------------------------------------------------------------------------
  console.log('\n[7] 前台取件：解析');
  const redeemEmail = await call('POST', '/public/redeem', { cards: [first.cardKey], format: 'email' });
  const emailLine = String(redeemEmail.json.results[0].content).trim().split('\n')[0];
  assert(emailLine.split('----').length >= 4, '兑换得到的邮箱凭据行可用', emailLine.slice(0, 60));

  const resolved = await call('POST', '/public/pickup/resolve', {
    input: `${emailLine}\nnobody@example.com\nnot-a-key`,
  });
  assert(resolved.json?.records?.length === 2, '解析出多条记录', `total=${resolved.json?.summary?.total}`);
  const lineRecord = resolved.json.records.find((row) => row.source === 'line');
  assert(lineRecord?.complete === true, '四段式凭据行解析成功');
  assert(resolved.json?.unknown?.length === 1, '无法识别的输入被单独返回', JSON.stringify(resolved.json?.unknown));

  const byCard = await call('POST', '/public/pickup/resolve', { input: first.cardKey });
  const cardRecord = byCard.json?.records?.find((row) => row.source === 'card');
  assert(Boolean(cardRecord), '卡密可解析为取件记录', cardRecord?.fromCard);
  assert(cardRecord?.complete === true, '卡密记录凭据完整');
  assert(cardRecord?.credits === CREDITS, '卡密记录带出额度', String(cardRecord?.credits));
  assert(cardRecord?.accountId === first.id, '卡密记录关联到账号');

  const fromJson = await call('POST', '/public/pickup/resolve', {
    files: [{ name: 'sub2api.json', content: JSON.stringify(await sampleAccountJson(call, first.cardKey)) }],
  });
  assert(fromJson.json?.records?.length === 1, '上传 sub2api JSON 可解析出取件账号', `total=${fromJson.json?.summary?.total}`);
  assert(fromJson.json.records[0].complete === true, 'JSON 中的取件凭据完整');

  // -------------------------------------------------------------------------
  console.log('\n[8] 后台取件弹窗接口');
  const mailbox = await call('GET', `/admin/accounts/${first.id}/mailbox?maxMessages=3`);
  assert(mailbox.json?.account?.id === first.id, '返回账号信息');
  assert(mailbox.json?.mailbox?.clientId, '返回邮箱 clientId');
  assert(Boolean(mailbox.json?.mailbox?.line), '返回四段式凭据行');
  assert(mailbox.json?.pickup !== undefined, '返回取件结果对象', mailbox.json?.pickup?.ok ? '取件成功' : `取件失败：${mailbox.json?.pickup?.error?.slice(0, 60)}`);
  if (mailbox.json?.pickup?.ok) {
    assert(Array.isArray(mailbox.json?.messages), '返回邮件列表', `${mailbox.json.messages.length} 封`);
    assert(
      mailbox.json.messages.every((message) => typeof message.bodyHtml === 'string'),
      '邮件正文已返回且经过净化',
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n[8.1] 前台取件：只传 key（凭据由服务端回查）');
  const lookupKey = (first.email || first.name || '').toLowerCase();
  console.log(`    传入 key=${lookupKey}`);
  const pureKeyFetch = await call('POST', '/public/pickup/fetch', {
    records: [{ key: lookupKey, email: first.email, line: '', fromCard: null }],
    maxMessages: 2,
  });
  assert(pureKeyFetch.json?.results?.length === 1, '仅凭邮箱也能取件');
  assert(
    pureKeyFetch.json.results[0].ok === true || !/凭据不完整/.test(pureKeyFetch.json.results[0].error || ''),
    '服务端从数据库回查到了完整凭据',
    pureKeyFetch.json.results[0].ok ? '取件成功' : `失败原因：${pureKeyFetch.json.results[0].error?.slice(0, 70)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n[8.2] 前台取件：只传卡密（fromCard）');
  const byCardFetch = await call('POST', '/public/pickup/fetch', {
    records: [{ key: first.cardKey, fromCard: first.cardKey }],
    maxMessages: 2,
  });
  assert(byCardFetch.json?.results?.length === 1, '仅凭卡密也能触发取件');
  assert(
    byCardFetch.json.results[0].ok === true || !/凭据不完整/.test(byCardFetch.json.results[0].error || ''),
    '卡密路径可以从数据库回查凭据',
    byCardFetch.json.results[0].ok ? '取件成功' : `失败原因：${byCardFetch.json.results[0].error?.slice(0, 70)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n[9] 刷新状态 / 取件定档');
  const refresh = await call('POST', '/admin/accounts/refresh-status', {
    ids: [first.id],
    targets: ['ban', 'redeem'],
  });
  assert(refresh.json?.processed === 1, '刷新接口处理了 1 条');
  assert(refresh.json?.ban && refresh.json?.redeem, '返回封禁/兑换双维度统计', JSON.stringify(refresh.json?.ban) + ' ' + JSON.stringify(refresh.json?.redeem));

  // 定档：只处理待定档账号，带 cursor 分批推进（返回 credits 计数与 nextCursor）
  const tierJob = await call('POST', '/admin/accounts/refresh-status', {
    filter: { credits: [0] },
    limit: 2,
    targets: ['credits'],
  });
  assert(tierJob.json?.credits !== undefined, '返回定档统计', JSON.stringify(tierJob.json?.credits));
  assert(
    (tierJob.json?.credits?.hit ?? 0) + (tierJob.json?.credits?.pending ?? 0) + (tierJob.json?.credits?.failed ?? 0) <=
      tierJob.json?.processed,
    '定档计数不超过处理条数',
    `processed=${tierJob.json?.processed}`,
  );
  assert(
    tierJob.json?.processed === 0 || typeof tierJob.json?.nextCursor === 'number',
    'cursor 分页推进可用',
    `nextCursor=${JSON.stringify(tierJob.json?.nextCursor)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n[10] 后台导出');
  for (const format of ['sub2api', 'cpa', 'email']) {
    const exported = await call('POST', '/admin/accounts/export', {
      format,
      filter: { credits: [CREDITS] },
      limit: 10,
    }, { allowFailure: true });
    assert(exported.status === 200, `导出 ${format} 成功`, `HTTP ${exported.status}, ${exported.text.length} 字节`);
    assert(Boolean(exported.headers.get('content-disposition')), `导出 ${format} 带附件文件名`, exported.headers.get('content-disposition'));
  }

  // -------------------------------------------------------------------------
  console.log('\n[11] 卡密管理 / 额度档位 / 设置 / 概览');
  const cards = await call('GET', '/admin/cards?pageSize=5');
  assert(cards.json?.items?.length > 0, '卡密列表可读', `total=${cards.json?.total}`);
  assert(cards.json.items[0].status === 'active', '卡密状态为 active');
  assert(
    cards.json.items.every((item) => typeof item.credits === 'number'),
    '卡密列表带出额度',
  );

  const tiersRead = await call('GET', '/admin/credit-tiers');
  assert(tiersRead.json?.items?.length > 0, '额度档位分布可读', `${tiersRead.json?.items?.length} 个`);
  const createTier = await call('POST', '/admin/credit-tiers', { credits: 8888 }, { allowFailure: true });
  assert(createTier.status === 404, '档位不支持手工新增（接口已移除）', `HTTP ${createTier.status}`);

  const settings = await call('GET', '/admin/settings');
  assert(settings.json?.siteName === 'Cardline', '设置可读');
  const patched = await call('PATCH', '/admin/settings', { announcement: '冒烟测试公告' });
  assert(patched.json?.announcement === '冒烟测试公告', '设置可写');
  await call('PATCH', '/admin/settings', { announcement: '' });

  const overview = await call('GET', '/admin/stats/overview');
  assert(overview.json?.accounts?.total > 0, '概览统计正常', `total=${overview.json?.accounts?.total}`);
  assert(typeof overview.json?.accounts?.pending === 'number', '概览给出待定档数量', `pending=${overview.json?.accounts?.pending}`);
  assert(Array.isArray(overview.json?.redeemTrend), '兑换趋势数据存在', `${overview.json?.redeemTrend?.length} 天`);
  assert(overview.json?.batches?.length >= 1, '批次记录存在', overview.json?.batches?.[0]?.batchId);
  assert(Array.isArray(overview.json?.tiers), '概览带出档位分布', `${overview.json?.tiers?.length} 个`);

  // -------------------------------------------------------------------------
  console.log('\n[12] 账号更新 / 待定档回退 / 清理');
  const patchedAccount = await call('PATCH', `/admin/accounts/${first.id}`, { remark: '冒烟测试备注' });
  assert(patchedAccount.json?.remark === '冒烟测试备注', '更新账号备注成功');
  const marked = await call('PATCH', `/admin/accounts/${first.id}`, { banStatus: 'normal' });
  assert(marked.json?.banStatus === 'normal', '手动标记封禁状态成功');
  await call('PATCH', `/admin/accounts/${first.id}`, { remark: '' });

  const reset = await call('PATCH', `/admin/accounts/${first.id}`, { credits: 0 });
  assert(reset.json?.creditStatus === 'pending', '额度可退回待定档', `credits=${reset.json?.credits}`);
  const blocked = await call('POST', '/public/redeem', { cards: [first.cardKey], format: 'sub2api' });
  assert(
    blocked.json?.results?.[0]?.code === 'CREDITS_PENDING',
    '退回待定档后该卡不再可兑换',
    blocked.json?.results?.[0]?.message,
  );
  const restored = await call('PATCH', `/admin/accounts/${first.id}`, { credits: CREDITS });
  assert(restored.json?.creditStatus === 'ready', '重新定档成功');

  console.log(`\n=== 结果：通过 ${passed} 项，失败 ${failed} 项 ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('\n冒烟测试异常终止：', error.message);
  process.exit(1);
});
