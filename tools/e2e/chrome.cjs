// Shared helpers for end-to-end tests: the built extension (dist/) in a
// throwaway, headless Chrome for Testing profile, driven over the DevTools
// protocol. Branded Chrome no longer loads unpacked extensions from the command
// line; Chrome for Testing (installed with Playwright) does.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { extensionId } = require('../openclaw/extension-id.cjs');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const delay = ms => new Promise(r => setTimeout(r, ms));

function defaultChrome() {
  if (process.env.ECHO_CHROME_BIN && fs.existsSync(process.env.ECHO_CHROME_BIN)) return process.env.ECHO_CHROME_BIN;
  try {
    const installed = require('playwright').chromium.executablePath();
    if (installed && fs.existsSync(installed)) return installed;
  } catch { /* Playwright is optional outside the development checkout. */ }
  for (const cache of [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')]) {
    if (!fs.existsSync(cache)) continue;
    const builds = fs.readdirSync(cache).filter(name => /^chromium-/.test(name)).sort().reverse();
    for (const build of builds) {
      const base = path.join(cache, build);
      const candidates = [
        path.join(base, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(base, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(base, 'chrome-linux/chrome'),
      ];
      const cached = candidates.find(fs.existsSync);
      if (cached) return cached;
    }
  }
  const common = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = common.find(fs.existsSync);
  if (found) return found;
  throw new Error('Chromium was not found. Run "npx playwright install chromium" or set ECHO_CHROME_BIN.');
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

/** Evaluate an expression in a target (worker or page), attaching only for the call. */
async function evaluate(cdp, targetId, expression) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  } finally {
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

async function findTarget(cdp, predicate, timeoutMs = 10_000) {
  for (const started = Date.now(); Date.now() - started < timeoutMs;) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const hit = targetInfos.find(predicate);
    if (hit) return hit;
    await delay(100);
  }
  return null;
}

/**
 * Start Chrome for Testing with ECHO loaded. Returns the CDP client, the
 * extension id, its service-worker target, the profile folder, and a cleanup function.
 */
async function launchEcho({ chrome, urls = ['about:blank'], extensionDir = dist, env = process.env } = {}) {
  chrome ||= defaultChrome();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-e2e-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(chrome, [
    '--headless=new', `--user-data-dir=${userDir}`, `--remote-debugging-port=${port}`,
    `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`,
    // Headless Chrome takes one start URL; the rest open over DevTools below.
    '--no-first-run', '--no-default-browser-check', urls[0] || 'about:blank',
  ], { stdio: 'ignore', env });
  const cleanup = () => {
    try { proc.kill(); } catch { /* already gone */ }
    try { fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Chrome still flushing; temp dir */ }
  };
  let version;
  for (let i = 0; i < 100 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await delay(100); }
  }
  if (!version) { cleanup(); throw new Error('Chrome for Testing did not start.'); }
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.ready;
  for (const url of urls.slice(1)) await cdp.send('Target.createTarget', { url });
  const id = extensionId();
  const worker = await findTarget(cdp, t => t.type === 'service_worker' && t.url === `chrome-extension://${id}/background.js`);
  if (!worker) { cleanup(); throw new Error(`ECHO (${id}) did not load.`); }
  // The worker's chrome.* bindings appear a moment after its target does.
  for (let i = 0; i < 50; i++) {
    if (await evaluate(cdp, worker.targetId, `typeof chrome.tabs?.query === 'function'`).catch(() => false)) break;
    await delay(200);
  }
  return { cdp, extensionId: id, worker, browser: version.Browser, userDir, cleanup };
}

module.exports = { CDP, evaluate, findTarget, launchEcho, delay, root, dist, defaultChrome };
