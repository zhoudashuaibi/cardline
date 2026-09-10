#!/usr/bin/env node
/**
 * 无依赖 CDP 页面巡检 + 流程脚本脚本。
 *
 *  1. 启动 headless Chrome（远程调试端口）
 *  2. 打开目标页面，收集 console 错误与未捕获异常
 *  3. 按步骤文件执行交互（eval / click / type / wait / screenshot / expect）
 *  4. 输出每步结果与截图
 *
 * 用法：
 *   node scripts/page-check.js <url> [screenshotPath]
 *   node scripts/page-check.js <url> --steps <steps.json>
 *
 * 步骤文件格式（数组）：
 *   { "eval": "document.querySelector('textarea').value = 'x'" }
 *   { "click": "button.primary" }            // 文本或 CSS 选择器
 *   { "clickText": "开始兑换" }
 *   { "wait": 1500 }
 *   { "shot": "path.png" }
 *   { "expect": "某些文字", "name": "步骤名" }
 *   { "snapshot": "bodyText" }
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const URL_TARGET = args[0] || 'http://127.0.0.1:5173/';
const stepsIndex = args.indexOf('--steps');
const STEPS_FILE = stepsIndex >= 0 ? args[stepsIndex + 1] : null;
const SHOT =
  !STEPS_FILE && args[1] && !args[1].startsWith('--')
    ? args[1]
    : path.join(os.tmpdir(), 'page-check.png');

const WIDTH = Number(process.env.PAGE_WIDTH || 1440);
const HEIGHT = Number(process.env.PAGE_HEIGHT || 960);
const PORT = 9222 + Math.floor(Math.random() * 500);

const CHROME_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
];

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('未找到 Chrome / Edge 可执行文件');
}

async function waitForEndpoint(retries = 60) {
  for (let index = 0; index < retries; index++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      /* 继续等待 */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('DevTools 端点未就绪');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const handler = this.handlers.get(message.method);
      if (handler) handler(message.params);
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 60000);
    });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 在页面里执行表达式并取回值 */
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description || result.exceptionDetails.text || '未知错误';
    throw new Error(description.split('\n')[0]);
  }
  return result.result.value;
}

/**
 * 点击元素：支持 CSS 选择器，或 { text } 形式按可见文字查找。
 * 用原生事件派发，绕过 headless 下的坐标点击问题。
 */
async function clickTarget(cdp, target) {
  const expression = `(() => {
    const spec = ${JSON.stringify(target)};
    const visible = (el) => el && el.offsetParent !== null;
    let el = null;
    if (spec.selector) {
      el = Array.from(document.querySelectorAll(spec.selector)).find(visible) || null;
    } else {
      const wanted = spec.text.replace(/\\s+/g, '');
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-select-selector, .ant-radio-button-wrapper, label, li, div'));
      el = candidates.find(node => visible(node) && (node.innerText || '').replace(/\\s+/g, '') === wanted)
        || candidates.find(node => visible(node) && (node.innerText || '').replace(/\\s+/g, '').includes(wanted) && node.children.length === 0);
    }
    if (!el) return { ok: false, reason: 'not-found' };
    const text = (el.innerText || '').trim().slice(0, 40);
    el.scrollIntoView({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return { ok: true, text, tag: el.tagName };
  })()`;
  const result = await evaluate(cdp, expression);
  if (!result || !result.ok) throw new Error(`点击目标未找到：${JSON.stringify(target)}`);
  return result;
}

/** 向输入框写值（React 受控组件需要走原生 setter + input 事件） */
async function typeInto(cdp, selector, value) {
  const expression = `(() => {
    const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n => n.offsetParent !== null)
      || document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: 'not-found' };
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, tag: el.tagName, value: el.value.slice(0, 60) };
  })()`;
  const result = await evaluate(cdp, expression);
  if (!result || !result.ok) throw new Error(`输入目标未找到：${selector}`);
  return result;
}

async function main() {
  const browserPath = findBrowser();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardline-cdp-'));
  const steps = STEPS_FILE
    ? JSON.parse(fs.readFileSync(STEPS_FILE, 'utf8').replace(/^\uFEFF/, ''))
    : [];

  console.log(`[page-check] 浏览器：${browserPath}`);
  console.log(`[page-check] 目标：${URL_TARGET}`);

  const child = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  };

  try {
    const version = await waitForEndpoint();
    console.log(`[page-check] ${version.Browser}`);

    const target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    });

    const cdp = new Cdp(ws);
    const logs = [];
    const errors = [];

    cdp.on('Runtime.consoleAPICalled', ({ type, args: callArgs }) => {
      const text = (callArgs || [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? '')
        .join(' ');
      if (type === 'error') errors.push(`[console.error] ${text}`);
      else logs.push(`[${type}] ${text}`);
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      const description =
        exceptionDetails?.exception?.description ||
        exceptionDetails?.text ||
        JSON.stringify(exceptionDetails);
      errors.push(description);
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') errors.push(`[network/log] ${entry.text}`);
      else logs.push(`[${entry.level}] ${entry.text}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await cdp.send('Page.navigate', { url: URL_TARGET });
    await sleep(5000);

    const shot = async (file) => {
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
      console.log(`    📷 ${file} (${fs.statSync(file).size} bytes)`);
    };

    let stepFailed = 0;

    for (const [index, step] of steps.entries()) {
      const label = step.name || `步骤 ${index + 1}`;
      try {
        if (step.eval !== undefined) {
          const value = await evaluate(cdp, step.eval);
          console.log(`  ✔ ${label}${value === undefined ? '' : ` → ${JSON.stringify(value).slice(0, 200)}`}`);
        }
        if (step.type !== undefined) {
          const info = await typeInto(cdp, step.selector, step.type);
          console.log(`  ✔ ${label}：已写入 ${step.selector}`);
          void info;
        }
        if (step.click !== undefined) {
          const info = await clickTarget(cdp, { selector: step.click });
          console.log(`  ✔ ${label}：点击 <${info.tag}> ${info.text}`);
        }
        if (step.clickText !== undefined) {
          const info = await clickTarget(cdp, { text: step.clickText });
          console.log(`  ✔ ${label}：点击 <${info.tag}> ${info.text}`);
        }
        if (step.wait !== undefined) await sleep(step.wait);
        if (step.expect !== undefined) {
          const found = await evaluate(
            cdp,
            `(document.body.innerText || '').includes(${JSON.stringify(step.expect)})`,
          );
          if (found) {
            console.log(`  ✔ ${label}：页面包含「${step.expect}」`);
          } else {
            stepFailed++;
            console.log(`  ✖ ${label}：页面缺少「${step.expect}」`);
          }
        }
        if (step.expectNot !== undefined) {
          const found = await evaluate(
            cdp,
            `(document.body.innerText || '').includes(${JSON.stringify(step.expectNot)})`,
          );
          if (!found) {
            console.log(`  ✔ ${label}：页面不含「${step.expectNot}」`);
          } else {
            stepFailed++;
            console.log(`  ✖ ${label}：页面仍含「${step.expectNot}」`);
          }
        }
        if (step.shot !== undefined) await shot(step.shot);
        if (step.text !== undefined) {
          const value = await evaluate(cdp, 'document.body.innerText');
          console.log(`  ── ${label} 正文 ──\n${String(value).slice(0, step.text)}\n  ──────────`);
        }
      } catch (error) {
        stepFailed++;
        console.log(`  ✖ ${label}：${error.message}`);
      }
    }

    if (!STEPS_FILE) {
      const probe = await evaluate(
        cdp,
        `JSON.stringify({
          url: location.href,
          title: document.title,
          rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
          h1: document.querySelector('h1') ? document.querySelector('h1').innerText : null,
          bodyText: (document.body.innerText || '').slice(0, 900),
          buttons: Array.from(document.querySelectorAll('button')).slice(0, 16).map(b => b.innerText.trim()).filter(Boolean)
        })`,
      );
      console.log('\n[page-check] 页面状态：');
      console.log(JSON.stringify(JSON.parse(probe), null, 2));
      await shot(SHOT);
    }

    if (errors.length) {
      console.log('\n[page-check] 页面错误：');
      errors.forEach((error) =>
        console.log(`  ✖ ${error.split('\n').slice(0, 6).join('\n    ')}`),
      );
    } else {
      console.log('\n[page-check] 无页面错误');
    }
    if (logs.length) {
      console.log('\n[page-check] 控制台输出：');
      logs.slice(0, 15).forEach((log) => console.log(`  · ${log.slice(0, 240)}`));
    }

    ws.close();
    cleanup();
    process.exit(errors.length || stepFailed ? 2 : 0);
  } catch (error) {
    console.error('[page-check] 失败：', error.message);
    cleanup();
    process.exit(1);
  }
}

main();
