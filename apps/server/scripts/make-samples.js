#!/usr/bin/env node
/**
 * 从真实参考资料生成「脱敏样例」，用于仓库演示与测试。
 *
 * 真实参考资料含有效凭据，已被 .gitignore 排除；
 * 这里的样例只保留结构、字段名与格式，所有 token / 密码 / ID 都替换为占位值。
 *
 * 用法：node scripts/make-samples.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT_DIR = path.join(ROOT, 'samples');

/** 生成一个结构合法、签名段为占位符的 JWT */
function fakeJwt(payload, header = { alg: 'RS256', typ: 'JWT', kid: 'SAMPLE-KEY-ID' }) {
  const part = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  return `${part(header)}.${part(payload)}.${'SAMPLE-SIGNATURE-NOT-A-REAL-TOKEN'.padEnd(64, 'x')}`;
}

function fakeRefreshToken(seed, length = 420) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!*-_';
  let out = '';
  let state = seed;
  while (out.length < length) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[state % alphabet.length];
  }
  return `M.C528_BAY.0.U.MsaArtifacts.${out}`;
}

const SAMPLE_ACCOUNTS = [
  {
    email: 'demo.user@outlook.com',
    name: 'Demo User',
    accountId: '00000000-0000-4000-9000-000000000001',
    userId: 'user-DEMO000000000000000000000001',
    planType: 'plus',
    mailboxPassword: 'demo-mailbox-pwd',
    clientId: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    pickupPassword: 'DEMO-PICKUP-PASSWORD',
    seed: 20260211,
  },
  {
    email: 'demo.free@outlook.com',
    name: 'Demo Free',
    accountId: '00000000-0000-4000-9000-000000000002',
    userId: 'user-DEMO000000000000000000000002',
    planType: 'free',
    mailboxPassword: 'demo-mailbox-pwd-2',
    clientId: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    pickupPassword: 'DEMO-PICKUP-PASSWORD-2',
    seed: 778899,
  },
];

function buildAccessToken(account, exp) {
  return fakeJwt({
    aud: ['https://api.openai.com/v1'],
    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    exp,
    iat: exp - 864000,
    iss: 'https://auth.openai.com',
    sub: `auth0|${account.userId}`,
    'https://api.openai.com/auth': {
      chatgpt_account_id: account.accountId,
      chatgpt_plan_type: account.planType,
      chatgpt_user_id: account.userId,
      user_id: account.userId,
    },
    'https://api.openai.com/profile': {
      email: account.email,
      email_verified: true,
      name: account.name,
    },
  });
}

function buildIdToken(account, exp) {
  return fakeJwt({
    aud: ['app_EMoamEEZ73f0CkXaXp7hrann'],
    email: account.email,
    email_verified: true,
    exp: exp - 864000 * 3,
    iat: exp - 864000 * 4,
    iss: 'https://auth.openai.com',
    sub: `auth0|${account.userId}`,
    'https://api.openai.com/auth': {
      chatgpt_account_id: account.accountId,
      chatgpt_plan_type: account.planType,
      chatgpt_user_id: account.userId,
      user_id: account.userId,
    },
  });
}

/** sub2api 导出包结构 */
function buildSub2ApiSample() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 864000;

  const accounts = SAMPLE_ACCOUNTS.map((account) => {
    const refreshToken = fakeRefreshToken(account.seed);
    const sourceLine = [
      account.email,
      account.mailboxPassword,
      account.clientId,
      refreshToken,
    ].join('----');

    const notes = JSON.stringify(
      {
        mailbox: {
          bind_email: account.email,
          primary_email: account.email,
          password: account.mailboxPassword,
          client_id: account.clientId,
          refresh_token: refreshToken,
          pickup_password: account.pickupPassword,
          provider: 'outlook',
          auth_type: 'oauth2',
          imap_host: 'outlook.office365.com',
          imap_port: '993',
          source_line: sourceLine,
        },
        gpt: { password: 'demo-chatgpt-password' },
        two_factor: {
          enabled_by_config: true,
          enabled: true,
          status: 'enabled',
          secret: 'DEMO2FASECRET234567',
        },
      },
      null,
      2,
    );

    return {
      name: `${account.email}----${account.pickupPassword}----demo-chatgpt-password`,
      notes,
      platform: 'openai',
      type: 'oauth',
      concurrency: 10,
      priority: 1,
      rate_multiplier: 1,
      auto_pause_on_expired: true,
      credentials: {
        access_token: buildAccessToken(account, exp),
        chatgpt_account_id: account.accountId,
        chatgpt_user_id: account.userId,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        email: account.email,
        expires_at: exp,
        id_token: buildIdToken(account, exp),
        organization_id: `org-${account.accountId}`,
        plan_type: account.planType,
        refresh_token: `rt.1.${fakeRefreshToken(account.seed + 1, 60)}`,
      },
      extra: {
        auth_provider: 'demo',
        email: account.email,
        mailbox_auth_type: 'oauth2',
        mailbox_email: account.email,
        mailbox_lookup_name: `${account.email}----${account.pickupPassword}----demo-chatgpt-password`,
        mailbox_provider: 'outlook',
        mailbox_user_email: account.email,
        openai_long_context_billing_enabled: false,
        openai_oauth_responses_websockets_v2_enabled: false,
        openai_oauth_responses_websockets_v2_mode: 'off',
        privacy_mode: 'training_off',
        source: 'sample-data',
        two_factor_enabled: true,
        two_factor_status: 'enabled',
      },
    };
  });

  return {
    type: 'sub2api-data',
    version: 1,
    exported_at: new Date().toISOString(),
    proxies: [],
    accounts,
  };
}

/** CPA（Codex auth）单账号结构 */
function buildCpaSample() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 864000;
  const account = SAMPLE_ACCOUNTS[0];

  return {
    type: 'codex',
    email: account.email,
    name: account.email,
    plan_type: account.planType,
    chatgpt_plan_type: account.planType,
    account_id: account.accountId,
    chatgpt_account_id: account.accountId,
    id_token: buildIdToken(account, exp),
    access_token: buildAccessToken(account, exp),
    refresh_token: `rt.1.${fakeRefreshToken(account.seed + 2, 60)}`,
    last_refresh: new Date().toISOString(),
    expired: new Date(exp * 1000).toISOString(),
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sub2apiPath = path.join(OUT_DIR, 'sub2api.sample.json');
  const cpaPath = path.join(OUT_DIR, 'cpa.sample.json');

  fs.writeFileSync(sub2apiPath, `${JSON.stringify(buildSub2ApiSample(), null, 2)}\n`, 'utf8');
  fs.writeFileSync(cpaPath, `${JSON.stringify(buildCpaSample(), null, 2)}\n`, 'utf8');

  console.log(`[make-samples] 已生成 ${path.relative(ROOT, sub2apiPath)}`);
  console.log(`[make-samples] 已生成 ${path.relative(ROOT, cpaPath)}`);
  console.log('[make-samples] 所有 token / 密码 / ID 均为占位值，可直接入库');
}

main();
