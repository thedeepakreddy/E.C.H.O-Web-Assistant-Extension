#!/usr/bin/env node
// Phase 5, end to end: ECHO as an MCP server for Claude Desktop and Claude
// Code. This test plays Claude: it starts echo-mcp the way Claude does and
// speaks MCP to it. ECHO runs in Chrome for Testing with Echo Helper installed
// the one-time way (HOME pointed at a temp folder). No OpenClaw, no model.
//
//   npm run build && node tools/openclaw/claude-e2e.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { launchEcho, evaluate, findTarget, delay } = require('../e2e/chrome.cjs');

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 180)}` : ''}`); };

async function waitFor(fn, timeoutMs, stepMs = 300) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(stepMs)) {
    const value = await fn().catch(() => null);
    if (value) return value;
  }
  return null;
}

/** Claude's side: an MCP client over echo-mcp's stdin and stdout. */
function mcpClient(program, env) {
  const child = spawn(process.execPath, [program], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buffer = '';
  let next = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const request = (method, params = {}) => new Promise(resolve => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return {
    request,
    call: async (name, args = {}) => (await request('tools/call', { name, arguments: args })).result,
    close: () => child.kill(),
  };
}
/** For people reviewing the change: a picture of a page, when SHOTS names a folder. */
async function shot(cdp, targetId, name, width, height) {
  if (!process.env.SHOTS) return;
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
  await evaluate(cdp, targetId, `(() => { const st = document.createElement('style'); st.textContent = '*{animation:none!important;transition:none!important}'; document.head.append(st); return true; })()`);
  await delay(600);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(process.env.SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
}
const textOf = result => (result?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');

async function main() {
  const fixtures = path.join(__dirname, 'fixtures');
  const server = http.createServer((req, res) => {
    const file = path.join(fixtures, path.basename(req.url.split('?')[0]));
    if (!fs.existsSync(file) || !file.endsWith('.html')) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/message.html`;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-claude-home-'));
  const echo = await launchEcho({ urls: [url] });
  const { cdp, extensionId, worker, userDir } = echo;
  let claude = null;
  process.on('exit', () => { claude?.close(); echo.cleanup(); server.close(); fs.rmSync(home, { recursive: true, force: true }); });
  const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
  await findTarget(cdp, t => t.targetId === panelId);
  await delay(1000);
  const panel = expr => evaluate(cdp, panelId, expr);
  const msg = m => panel(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);

  // 1. The one-time helper install, as ECHO offers it.
  const offer = await msg({ type: 'ECHO_AGENT_MODE', action: 'turn-on' });
  fs.mkdirSync(path.join(home, 'Library/Application Support/Google/Chrome'), { recursive: true });
  execFileSync('bash', ['-c', offer.command], { stdio: 'ignore', env: { ...process.env, HOME: home } });
  const helperDir = path.join(home, '.openclaw-echo/echo-helper');
  fs.mkdirSync(path.join(userDir, 'NativeMessagingHosts'), { recursive: true });
  fs.copyFileSync(path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.echo.helper.json'),
    path.join(userDir, 'NativeMessagingHosts/com.echo.helper.json'));
  const installed = JSON.parse(fs.readFileSync(path.join(helperDir, 'echo-tools.json'), 'utf8'));
  check('the install includes echo-mcp and ECHO\'s tool list', fs.existsSync(path.join(helperDir, 'echo-mcp')) && installed.some(t => t.name === 'observe'),
    installed.map(t => t.name).join(', '));

  // 2. Let Claude use ECHO.
  await msg({ type: 'ECHO_CLAUDE', action: 'enable' });
  const up = await waitFor(async () => (await msg({ type: 'ECHO_CLAUDE', action: 'status' })).status?.connected, 20_000);
  check('turning it on connects ECHO to Echo Helper', !!up, JSON.stringify((await msg({ type: 'ECHO_CLAUDE', action: 'status' })).status));

  // 3. Claude starts echo-mcp (HOME as installed, so it finds the same socket as the helper).
  claude = mcpClient(path.join(helperDir, 'echo-mcp.mjs'), { HOME: home });
  const hello = await claude.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-claude', version: '1' } });
  check('Claude sees ECHO as an MCP server', hello.result?.serverInfo?.name === 'echo', hello.result?.instructions);
  const tools = (await claude.request('tools/list')).result?.tools || [];
  const names = tools.map(t => t.name);
  check('Claude gets ECHO\'s browser tools, not the ones only ECHO\'s agents can use', ['observe', 'act', 'navigate', 'verify'].every(n => names.includes(n)) && !names.includes('watch'),
    names.join(', '));

  // 4. Nothing shared yet: nothing to see.
  const unshared = await claude.call('observe');
  check('with no tab shared, Claude is told how to share one', unshared?.isError && /No tab is shared with Claude/.test(textOf(unshared)), textOf(unshared));

  // 5. The user shares the page with Claude.
  const tab = await evaluate(cdp, worker.targetId, `chrome.tabs.query({}).then(t => t.find(x => x.url.includes('message.html')).id)`);
  const shared = await msg({ type: 'ECHO_AGENT_ASSIGN', agent: 'claude', tabId: tab });
  check('the user shares the tab with Claude', shared?.success, shared?.error);
  const seen = await claude.call('observe');
  const page = textOf(seen);
  check('Claude reads the shared page', /Message the team/.test(page) && /team@example\.com/.test(page), page.slice(0, 160));
  const box = page.match(/\[(e\d+)\][^\n]*(message|textbox|textarea)/i)?.[1] || page.match(/\[(e\d+)\][^\n]*Your message/i)?.[1];
  const send = page.match(/\[(e\d+)\][^\n]*Send message/)?.[1];
  check('controls come with references Claude can act on', !!box && !!send, `${box} ${send}`);

  // 6. Sending asks the user in ECHO. Deny: nothing is sent.
  const approvalText = () => panel(`document.querySelector('.echo-approval')?.innerText || ''`);
  const press = async label => {
    const at = await panel(`(() => { const b = [...document.querySelectorAll('.echo-approval button')].find(b => b.innerText.trim() === ${JSON.stringify(label)});
      const r = b?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: panelId, flatten: true });
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, sessionId);
  };
  const pageState = async () => evaluate(cdp, (await findTarget(cdp, t => t.type === 'page' && t.url.includes('message.html'))).targetId, `window.__sent`);
  const sendText = text => claude.call('act', { steps: [{ do: 'type', ref: box, text }, { do: 'click', ref: send }] });

  // Allow once: it is sent.
  const first = sendText('Hello from Claude');
  const asked = await waitFor(async () => { const t = await approvalText(); return /Claude asks: allow this\?/.test(t) && t; }, 20_000);
  check('the send waits, and ECHO asks: "Claude asks: allow this?"', !!asked, asked || await approvalText());
  await shot(cdp, panelId, 'claude-approval', 420, 820);
  check('nothing is sent before the answer', (await pageState()) === null);
  await press('Allow once');
  const firstResult = textOf(await first);
  check('Allow once: the message is sent', (await pageState()) === 'Hello from Claude', firstResult.slice(0, 160));

  // Deny: nothing is sent, and Claude is told.
  const second = sendText('Second message');
  await waitFor(async () => /allow this\?/.test(await approvalText()), 20_000);
  await press('Deny');
  const secondResult = textOf(await second);
  check('Deny: nothing is sent, and Claude is told', (await pageState()) === 'Hello from Claude' && /denied/i.test(secondResult), secondResult.slice(0, 160));

  // Asking again for what the user just denied is refused without a new prompt.
  const third = textOf(await claude.call('act', { steps: [{ do: 'click', ref: send }] }));
  check('a denied send is not asked about again', (await pageState()) === 'Hello from Claude' && !(await approvalText()), third.slice(0, 160));

  if (process.env.SHOTS) {
    await panel(`document.querySelector('.echo-agents-pill').click(); true`);
    await delay(1200);
    await panel(`document.querySelector('.echo-claude-card')?.scrollIntoView({ block: 'center' }); true`);
    await shot(cdp, panelId, 'claude-roster', 420, 820);
    const { targetId: optId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/options.html` });
    await findTarget(cdp, t => t.targetId === optId);
    await delay(2500);
    await evaluate(cdp, optId, `(() => { const h = [...document.querySelectorAll('.group-title')].find(x => /Claude Desktop/.test(x.textContent)); h?.scrollIntoView({ block: 'start' }); return !!h; })()`);
    await shot(cdp, optId, 'claude-settings', 1100, 700);
  }

  // 8. Stop sharing: Claude has no tab again.
  await msg({ type: 'ECHO_AGENT_RELEASE', agent: 'claude' });
  const after = await claude.call('observe');
  check('after "Stop sharing", Claude can\'t see the page', after?.isError && /No tab is shared/.test(textOf(after)));

  // 9. Turned off: echo-mcp says how to turn it back on.
  await msg({ type: 'ECHO_CLAUDE', action: 'disable' });
  await delay(1500);
  const off = await claude.call('observe');
  check('turned off, Claude is told how to turn it on', off?.isError && /Let Claude use ECHO/.test(textOf(off)), textOf(off));

  cdp.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nClaude e2e failed:', error.stack || error.message); process.exit(1); });
