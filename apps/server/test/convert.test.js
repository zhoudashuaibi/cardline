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
