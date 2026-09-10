#!/usr/bin/env node
/**
 * 格式转换回归测试：sub2api ⇄ CPA ⇄ 邮箱 TXT
 * 运行：npm run test:convert --workspace @cardline/server
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const { ConvertService } = require(path.join(__dirname, '..', 'dist', 'convert', 'convert.service.js'));
const { readSub2ApiPassthrough } = require(path.join(
  __dirname,
  '..',
  'dist',
  'convert',
  'convert.service.js',
));

const service = new ConvertService();

function b64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function accessToken({ exp = 1900000000, accountId = 'acct-1', planType = 'plus', email = 'user@outlook.com' } = {}) {
  return [
    b64url({ alg: 'RS256', typ: 'JWT' }),
    b64url({
      exp,
      email,
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: planType,
        chatgpt_user_id: 'user-1',
      },
    }),
    'sig',
  ].join('.');
}

/** 一份贴近真实 sub2api 导出结构的样例 */
function sub2apiSample() {
  const notes = JSON.stringify({
    mailbox: {
      bind_email: 'user@outlook.com',
      primary_email: 'user@outlook.com',
      password: 'jpqxdw31909',
      client_id: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
      refresh_token: 'M.C528_BAY.0.U.MsaArtifacts.' + 'x'.repeat(120),
      pickup_password: 'ABCDEFGHIJKLMNOPQRSTUV',
      provider: 'outlook',
      auth_type: 'oauth2',
      imap_host: 'outlook.office365.com',
      imap_port: '993',
      source_line:
        'user@outlook.com----jpqxdw31909----9e5f94bc-e8a4-4e73-b8be-63364c29d753----M.C528_BAY.0.U.MsaArtifacts.' +
        'x'.repeat(120),
    },
    gpt: { password: 'os0eqfThQ!ZPytq8A1!' },
  });

  return {
    type: 'sub2api-data',
    version: 1,
    exported_at: '2026-09-09T06:46:18.157Z',
    proxies: [],
    accounts: [
      {
        name: 'user@outlook.com----ABCDEFGHIJKLMNOPQRSTUV----os0eqfThQ!ZPytq8A1!',
        notes,
        platform: 'openai',
        type: 'oauth',
        concurrency: 10,
        priority: 1,
        credentials: {
          access_token: accessToken(),
          chatgpt_account_id: 'acct-1',
          chatgpt_user_id: 'user-1',
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
          email: 'user@outlook.com',
          expires_at: 1900000000,
          id_token: [b64url({ alg: 'RS256' }), b64url({ email: 'user@outlook.com' }), 'sig'].join('.'),
          plan_type: 'plus',
          refresh_token: 'rt.1.REFRESH-TOKEN-VALUE-0123456789',
        },
        extra: {
          email: 'user@outlook.com',
          mailbox_email: 'user@outlook.com',
          mailbox_provider: 'outlook',
          mailbox_lookup_name: 'user@outlook.com----ABCDEFGHIJKLMNOPQRSTUV----os0eqfThQ!ZPytq8A1!',
          source: 'improved-registrar',
        },
      },
    ],
  };
}

test('sub2api → 内部模型：切出账号并提取邮箱取件凭据', () => {
  const result = service.parseAccounts(JSON.stringify(sub2apiSample()), 'sample.json');
  assert.equal(result.issues.length, 0, `不应有解析问题：${JSON.stringify(result.issues)}`);
  assert.equal(result.items.length, 1);

  const account = result.items[0].account;
  assert.equal(account.email, 'user@outlook.com');
  assert.equal(account.accountId, 'acct-1');
  assert.equal(account.planType, 'plus');
  assert.equal(account.accessTokenExpiresAt, 1900000000);
  assert.equal(account.mailbox.email, 'user@outlook.com');
  assert.equal(account.mailbox.clientId, '9e5f94bc-e8a4-4e73-b8be-63364c29d753');
  assert.match(account.mailbox.refreshToken, /^M\.C528_BAY/);
  assert.match(account.mailbox.line, /^user@outlook\.com----jpqxdw31909----9e5f94bc/);
});

test('sub2api → CPA：字段映射正确，id_token 保留', () => {
  const { items } = service.parseAccounts(JSON.stringify(sub2apiSample()));
  const cpa = service.toCpaDocument(items.map((item) => item.account));

  assert.equal(Array.isArray(cpa), false, '单账号应输出对象而非数组');
  assert.equal(cpa.type, 'codex');
  assert.equal(cpa.email, 'user@outlook.com');
  assert.equal(cpa.account_id, 'acct-1');
  assert.equal(cpa.chatgpt_account_id, 'acct-1');
  assert.equal(cpa.plan_type, 'plus');
  assert.equal(cpa.refresh_token, 'rt.1.REFRESH-TOKEN-VALUE-0123456789');
  assert.equal(cpa.id_token_synthetic, undefined, '存在真实 id_token 时不应标记合成');
  assert.equal(cpa.id_token.split('.').length, 3);
});

test('CPA → sub2api：往返后凭据与邮箱取件信息不丢', () => {
  const { items } = service.parseAccounts(JSON.stringify(sub2apiSample()));
  const cpa = service.toCpaDocument(items.map((item) => item.account));

  const back = service.parseAccounts(JSON.stringify(cpa), 'cpa.json');
  assert.equal(back.issues.length, 0, `CPA 解析不应报错：${JSON.stringify(back.issues)}`);
  assert.equal(back.items.length, 1);

  const account = back.items[0].account;
  assert.equal(account.email, 'user@outlook.com');
  assert.equal(account.planType, 'plus');
  assert.equal(account.refreshToken, 'rt.1.REFRESH-TOKEN-VALUE-0123456789');

  const doc = service.toSub2ApiDocument([account]);
  assert.equal(doc.type, 'sub2api-data');
  assert.equal(doc.accounts.length, 1);
  assert.equal(doc.accounts[0].platform, 'openai');
  assert.equal(doc.accounts[0].type, 'oauth');
  assert.equal(doc.accounts[0].credentials.email, 'user@outlook.com');
  assert.equal(doc.accounts[0].credentials.refresh_token, 'rt.1.REFRESH-TOKEN-VALUE-0123456789');
});

test('缺少 id_token 时构造 Codex 可解析的占位 JWT', () => {
  const bare = {
    type: 'codex',
    email: 'bare@outlook.com',
    access_token: accessToken({ accountId: 'acct-bare', email: 'bare@outlook.com' }),
    refresh_token: 'rt.1.BARE',
  };
  const { items, issues } = service.parseAccounts(JSON.stringify(bare), 'bare.json');
  assert.equal(issues.length, 0);

  const cpa = service.toCpaAccount(items[0].account);
  assert.equal(cpa.id_token_synthetic, true);
  const parts = cpa.id_token.split('.');
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.length > 0));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.email, 'bare@outlook.com');
  assert.equal(payload['https://api.openai.com/auth'].chatgpt_account_id, 'acct-bare');
});

test('邮箱 TXT 交付：每行都是四段式凭据行', () => {
  const { items } = service.parseAccounts(JSON.stringify(sub2apiSample()));
  const lines = service.toEmailLines(items.map((item) => item.account));
  assert.equal(lines.length, 1);
  const parts = lines[0].split('----');
  assert.equal(parts[0], 'user@outlook.com');
  assert.equal(parts[1], 'jpqxdw31909');
  assert.equal(parts[2], '9e5f94bc-e8a4-4e73-b8be-63364c29d753');
  assert.match(parts[3], /^M\.C528_BAY/);
});

test('多账号：CPA 输出数组，sub2api 输出整包', () => {
  const doc = sub2apiSample();
  const second = JSON.parse(JSON.stringify(doc.accounts[0]));
  second.name = 'other@outlook.com';
  second.credentials.email = 'other@outlook.com';
  second.credentials.access_token = accessToken({ accountId: 'acct-2', email: 'other@outlook.com' });
  second.notes = undefined;
  doc.accounts.push(second);

  const { items } = service.parseAccounts(JSON.stringify(doc), 'multi.json');
  assert.equal(items.length, 2);

  const cpa = service.toCpaDocument(items.map((item) => item.account));
  assert.equal(Array.isArray(cpa), true);
  assert.equal(cpa.length, 2);

  const sub2api = service.toSub2ApiDocument(items.map((item) => item.account));
  assert.equal(sub2api.accounts.length, 2);
  assert.equal(sub2api.proxies.length, 0);
});

test('JSONL 与卡密导出 TXT 中的 JSON 片段都能识别', () => {
  const doc = sub2apiSample();
  const jsonl = [JSON.stringify(doc.accounts[0]), JSON.stringify(doc.accounts[0])].join('\n');
  assert.equal(
    service.parseAccounts(jsonl, 'a.jsonl').items.length,
    2,
    'JSONL 每行都是一个独立文档，重复由导入层去重',
  );

  const wrapped = `【订单号】20260211001\n【商品名称】ChatGPT Plus 账号\n=== 卡密内容 ===\n${JSON.stringify(
    doc.accounts[0],
    null,
    2,
  )}\n=== 结束 ===\n`;
  const result = service.parseAccounts(wrapped, 'order.txt');
  assert.equal(result.items.length, 1, '卡密导出 TXT 应能提取内嵌 JSON');
});

test('非法输入给出可读原因', () => {
  const result = service.parseAccounts('{"foo":1}', 'bad.json');
  assert.equal(result.items.length, 0);
  assert.ok(result.issues.length >= 1);
  assert.match(result.issues[0].reason, /access_token/);
});

test('真实参考文件（存在时）可以被解析', (t) => {
  const reference = path.join(__dirname, '..', '..', '..', 'sub2api_格式参考.json');
  if (!fs.existsSync(reference)) {
    // 该文件含真实账号凭据，已被 .gitignore 排除，CI 环境下不存在
    t.skip('未找到 sub2api_格式参考.json（含真实凭据，不入库）');
    return;
  }
  const content = fs.readFileSync(reference, 'utf8');
  const result = service.parseAccounts(content, 'sub2api_格式参考.json');
  assert.ok(result.items.length > 0, '应解析出账号');
  assert.equal(result.issues.length, 0, `不应有解析问题：${JSON.stringify(result.issues.slice(0, 3))}`);

  for (const item of result.items) {
    assert.ok(item.account.name, '账号名不应为空');
    assert.ok(item.account.accessToken, 'access_token 不应为空');
    assert.ok(item.account.mailbox?.clientId, '应提取到邮箱 client_id');
    assert.ok(item.account.mailbox?.refreshToken, '应提取到邮箱 refresh_token');
  }

  const cpaLines = service.buildDeliverContent('cpa', result.items.map((item) => item.account));
  JSON.parse(cpaLines);
  const sub2apiLines = service.buildDeliverContent('sub2api', result.items.map((item) => item.account));
  const rebuilt = JSON.parse(sub2apiLines);
  assert.equal(rebuilt.accounts.length, result.items.length);

  const emailLines = service.buildDeliverContent('email', result.items.map((item) => item.account));
  const rows = emailLines.trim().split('\n');
  assert.equal(rows.length, result.items.length);
  for (const row of rows) assert.equal(row.split('----').length >= 4, true, `凭据行异常：${row.slice(0, 60)}`);
});

test('脱敏样例文件 samples/sub2api.sample.json 可以被解析', (t) => {
  const sample = path.join(__dirname, '..', '..', '..', 'samples', 'sub2api.sample.json');
  if (!fs.existsSync(sample)) {
    t.skip('未找到 samples/sub2api.sample.json');
    return;
  }
  const result = service.parseAccounts(fs.readFileSync(sample, 'utf8'), 'sub2api.sample.json');
  assert.ok(result.items.length > 0, '脱敏样例应能解析出账号');
  assert.equal(result.issues.length, 0, `不应有解析问题：${JSON.stringify(result.issues)}`);

  for (const item of result.items) {
    assert.ok(item.account.mailbox?.clientId, '应提取到邮箱 client_id');
    assert.ok(item.account.mailbox?.refreshToken, '应提取到邮箱 refresh_token');
    assert.match(item.account.mailbox.line, /^[^@]+@[^@]+----/);
  }

  // 三种输出格式都能生成且结构正确
  const sub2api = JSON.parse(service.buildDeliverContent('sub2api', result.items.map((i) => i.account)));
  assert.equal(sub2api.accounts.length, result.items.length);
  const cpa = service.buildDeliverContent('cpa', result.items.map((i) => i.account));
  JSON.parse(cpa);
  const emailText = service.buildDeliverContent('email', result.items.map((i) => i.account));
  assert.equal(emailText.trim().split('\n').length, result.items.length);
});

test('脱敏样例 samples/cpa.sample.json 可以被解析', (t) => {
  const sample = path.join(__dirname, '..', '..', '..', 'samples', 'cpa.sample.json');
  if (!fs.existsSync(sample)) {
    t.skip('未找到 samples/cpa.sample.json');
    return;
  }
  const result = service.parseAccounts(fs.readFileSync(sample, 'utf8'), 'cpa.sample.json');
  assert.ok(result.items.length > 0, '脱敏 CPA 样例应能解析出账号');
  assert.equal(result.items[0].account.email, 'demo.user@outlook.com');
  assert.equal(result.items[0].account.planType, 'plus');
});

test('合并下载：多张卡密的账号合成一份 accounts 包装文档', () => {  // 模拟「批量下载全部」：3 张卡密，每张交付 1 个账号
  const parsed = service.parseAccounts(JSON.stringify(sub2apiSample()), 'sample.json');
  const perCard = parsed.items.map((item) => item.account);
  const all = [...perCard, ...perCard, ...perCard];
  assert.equal(all.length, 3);

  // sub2api：结构与单卡一致，账号累积到同一个数组
  const sub2api = JSON.parse(service.buildMergedContent('sub2api', all));
  assert.equal(sub2api.type, 'sub2api-data');
  assert.equal(sub2api.version, 1);
  assert.ok(Array.isArray(sub2api.proxies), 'proxies 应为数组');
  assert.equal(sub2api.accounts.length, 3, '三张卡密的账号应在同一个 accounts 数组里');
  assert.ok(sub2api.exported_at, 'exported_at 应存在');
  assert.ok(sub2api.accounts[0].credentials?.access_token, 'credentials.access_token 不应丢');

  // CPA：批量必须是 accounts 包装对象（不是数组、也不是多份文档相接）
  const cpaText = service.buildMergedContent('cpa', all);
  const cpa = JSON.parse(cpaText);
  assert.equal(Array.isArray(cpa), false, 'CPA 合并文档应为包装对象');
  assert.equal(cpa.accounts.length, 3);
  assert.ok(cpa.exported_at, 'exported_at 应存在');
  assert.ok(Array.isArray(cpa.proxies), 'proxies 应为数组');
  for (const account of cpa.accounts) assert.equal(account.type, 'codex');
  assert.equal(Object.prototype.hasOwnProperty.call(cpa, 'x_revive_manifest'), false, '无法签名的清单不应写入');

  // 合并后的文件必须能原样再导入（否则「一份文件」没有意义）
  const reimportedSub2Api = service.parseAccounts(service.buildMergedContent('sub2api', all), 'merged.json');
  assert.equal(reimportedSub2Api.issues.length, 0, JSON.stringify(reimportedSub2Api.issues.slice(0, 3)));
  assert.equal(reimportedSub2Api.items.length, 3);
  const reimportedCpa = service.parseAccounts(cpaText, 'merged-cpa.json');
  assert.equal(reimportedCpa.issues.length, 0, JSON.stringify(reimportedCpa.issues.slice(0, 3)));
  assert.equal(reimportedCpa.items.length, 3);

  // email：直接拼行，不带 ===== 卡密 ===== 之类的分隔标题
  const emailText = service.buildMergedContent('email', all);
  assert.equal(emailText.includes('====='), false, '邮箱 TXT 不应带分隔标题');
  assert.equal(emailText.trim().split('\n').length, 3);
  for (const line of emailText.trim().split('\n')) {
    assert.ok(line.split('----').length >= 4, `凭据行异常：${line.slice(0, 60)}`);
  }
});

test('交付时保留 extra（含 2FA 标记）与 concurrency / rate_multiplier / group_ids', () => {
  const sample = sub2apiSample();
  sample.accounts[0].concurrency = 5;
  sample.accounts[0].priority = 3;
  sample.accounts[0].rate_multiplier = 2;
  sample.accounts[0].group_ids = [4, 7];
  sample.accounts[0].extra = {
    auth_provider: 'chatgpt2api',
    chatgpt_web_message_error: '',
    chatgpt_web_message_status: '',
    mailbox_outlook_email: 'user@outlook.com',
    privacy_mode: 'training_off',
    two_factor_enabled: true,
    two_factor_error: '',
    two_factor_status: 'enabled',
  };

  const { items } = service.parseAccounts(JSON.stringify(sample), 'sample.json');
  const out = JSON.parse(service.buildDeliverContent('sub2api', items.map((i) => i.account)))
    .accounts[0];

  assert.equal(out.extra.two_factor_enabled, true, '2FA 开关应保留');
  assert.equal(out.extra.two_factor_status, 'enabled', '2FA 状态应保留');
  assert.equal(out.extra.two_factor_error, '', '空串字段也要原样保留');
  assert.equal(out.extra.chatgpt_web_message_error, '');
  assert.equal(out.extra.auth_provider, 'chatgpt2api');
  assert.equal(out.extra.privacy_mode, 'training_off');
  assert.equal(out.extra.mailbox_outlook_email, 'user@outlook.com');

  assert.equal(out.concurrency, 5, '不能被默认值 10 覆盖');
  assert.equal(out.priority, 3, '不能被默认值 1 覆盖');
  assert.equal(out.rate_multiplier, 2);
  assert.deepEqual(out.group_ids, [4, 7]);
});

test('数据库重建路径：rawJson 里的 extra 能被还原（兑换/后台导出都走这里）', () => {  // 导入时落库的原始对象
  const raw = {
    name: 'user@outlook.com----PICKUP----gpt-pwd',
    platform: 'openai',
    type: 'oauth',
    concurrency: 5,
    priority: 3,
    rate_multiplier: 2,
    auto_pause_on_expired: false,
    group_ids: [4],
    credentials: { access_token: accessToken(), email: 'user@outlook.com' },
    extra: {
      auth_provider: 'chatgpt2api',
      privacy_mode: 'training_off',
      two_factor_enabled: true,
      two_factor_error: '',
      two_factor_status: 'enabled',
    },
  };

  // 模拟 public.service / accounts.service 从数据库行重建 NormalizedAccount
  const normalized = {
    name: 'user@outlook.com',
    accessToken: accessToken(),
    email: 'user@outlook.com',
    rawSource: 'sub2api',
    raw,
    ...readSub2ApiPassthrough(raw),
  };

  const out = JSON.parse(service.buildDeliverContent('sub2api', [normalized])).accounts[0];
  assert.equal(out.extra.two_factor_enabled, true);
  assert.equal(out.extra.two_factor_status, 'enabled');
  assert.equal(out.extra.two_factor_error, '', '空串字段也要原样保留');
  assert.equal(out.extra.auth_provider, 'chatgpt2api');
  assert.equal(out.extra.privacy_mode, 'training_off');
  assert.equal(out.concurrency, 5);
  assert.equal(out.priority, 3);
  assert.equal(out.rate_multiplier, 2);
  assert.equal(out.auto_pause_on_expired, false, 'false 不能被默认值覆盖');
  assert.deepEqual(out.group_ids, [4]);
});

test('CPA 交付：主体仍是 Codex auth，额外带 extra（含 2FA 标记，不含 TOTP 密钥）', () => {
  const sample = sub2apiSample();
  sample.accounts[0].extra = {
    auth_provider: 'chatgpt2api',
    privacy_mode: 'training_off',
    two_factor_enabled: true,
    two_factor_error: '',
    two_factor_status: 'enabled',
  };

  const { items } = service.parseAccounts(JSON.stringify(sample), 'sample.json');
  const account = items[0].account;
  const cpa = service.toCpaDocument([account]);

  // Codex auth 主体字段一个都不能少
  assert.equal(cpa.type, 'codex', 'CPA 主体仍是 Codex auth');
  assert.ok(cpa.access_token, 'access_token 存在');
  assert.equal(cpa.id_token.split('.').length, 3, 'id_token 为三段式 JWT');
  assert.equal(cpa.refresh_token, 'rt.1.REFRESH-TOKEN-VALUE-0123456789');
  assert.equal(cpa.plan_type, 'plus');

  // extra：2FA 标记原样保留
  assert.equal(cpa.extra.two_factor_enabled, true);
  assert.equal(cpa.extra.two_factor_status, 'enabled');
  assert.equal(cpa.extra.two_factor_error, '', '空串字段也要原样保留');
  assert.equal(cpa.extra.auth_provider, 'chatgpt2api');
  assert.equal(cpa.extra.privacy_mode, 'training_off');

  // 不注入服务端补充键，也不带 notes（TOTP 密钥在 notes.two_factor.secret）
  assert.equal('email_key' in cpa.extra, false);
  assert.equal('mailbox_lookup_name' in cpa.extra, false);
  assert.equal('notes' in cpa, false, 'CPA 不带 notes，因此不含 TOTP 密钥');
  assert.equal(JSON.stringify(cpa).includes('ABCDEFGHIJKLMNOPQRSTUV'), false, '不应出现取件凭据行');

  // 批量合并文档里的账号条目同样带 extra
  const batch = JSON.parse(service.buildMergedContent('cpa', [account, account]));
  assert.equal(batch.accounts.length, 2);
  for (const entry of batch.accounts) {
    assert.equal(entry.type, 'codex');
    assert.equal(entry.extra.two_factor_status, 'enabled');
  }

  // 再导入不丢 extra
  const back = service.parseAccounts(JSON.stringify(cpa), 'cpa.json');
  assert.equal(back.items[0].account.extra.two_factor_status, 'enabled');
});

test('CPA 交付：来源没有 extra 时不写这个键（保持产物形态不变）', () => {
  const cpaSample = path.join(__dirname, '..', '..', '..', 'samples', 'cpa.sample.json');
  if (!fs.existsSync(cpaSample)) {
    // 用一份最小裸 Codex auth 代替
    const bare = {
      type: 'codex',
      email: 'demo.user@outlook.com',
      access_token: accessToken(),
      refresh_token: 'rt.1.X',
      account_id: 'acct-1',
    };
    const cpa = service.toCpaDocument(
      service.parseAccounts(JSON.stringify(bare), 'bare.json').items.map((i) => i.account),
    );
    assert.equal('extra' in cpa, false);
    return;
  }
  const parsed = service.parseAccounts(fs.readFileSync(cpaSample, 'utf8'), 'cpa.sample.json');
  const cpa = service.toCpaDocument(parsed.items.map((i) => i.account));
  assert.equal(cpa.type, 'codex');
  assert.equal('extra' in cpa, false, '裸 Codex auth 导入后不应凭空多出 extra');
});
