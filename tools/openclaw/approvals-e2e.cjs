#!/usr/bin/env node
// Phase 4, end to end: an agent sends an email through a connected app, and
// ECHO asks first, exactly like a send in the browser. Everything is a stand-in
// except ECHO and OpenClaw: a throwaway gateway profile (never ECHO's own), a
// test mail app that writes "sent" mail to a file, and a scripted model, so no
// real account is touched and no model quota is used.
//
//   npm run build && node tools/openclaw/approvals-e2e.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const ts = require('typescript');
const { launchEcho, evaluate, findTarget, delay } = require('../e2e/chrome.cjs');

const ROOT = path.resolve(__dirname, '../..');
const OPENCLAW = path.join(os.homedir(), '.npm-global/bin/openclaw');
const PROFILE = 'echo-e2e-apps';
const PORT = 18801;
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 180)}` : ''}`); };
const oc = (...args) => execFileSync(OPENCLAW, ['--profile', PROFILE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ocJson = (...args) => { const out = oc(...args, '--json'); return JSON.parse(out.slice(out.search(/[[{]/))); };

async function waitFor(fn, timeoutMs, stepMs = 500) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(stepMs)) {
    const value = await fn().catch(() => null);
    if (value) return value;
  }
  return null;
}

// ECHO's agent registry, straight from the source, so the gateway gets exactly ECHO's agents and commands.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);
const registry = require(path.join(ROOT, 'src/background/openclaw/registry.ts'));

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-apps-e2e-'));
  const sentLog = path.join(work, 'sent.jsonl');
  const stateDir = path.join(os.homedir(), `.openclaw-${PROFILE}`);
  const children = [];
  let cleanup = () => {};
  process.on('exit', () => {
    // The gateway runs as a child of its launcher: stop the whole group.
    for (const c of children) { try { process.kill(-c.pid); } catch { try { c.kill(); } catch { /* gone */ } } }
    cleanup();
    // Let the gateway finish writing as it stops, then remove its profile.
    try { execFileSync('/bin/sleep', ['2']); } catch { /* fine */ }
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });
  fs.rmSync(stateDir, { recursive: true, force: true });

  // The scripted model.
  const model = spawn(process.execPath, [path.join(__dirname, 'fixtures/scripted-model.mjs'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(model);
  const modelPort = await new Promise(resolve => model.stdout.on('data', d => { const m = String(d).match(/listening (\d+)/); if (m) resolve(Number(m[1])); }));

  // Echo guard, installed the way Echo Helper installs it.
  const guardDir = path.join(work, 'echo-guard');
  fs.mkdirSync(guardDir);
  fs.copyFileSync(path.join(ROOT, 'src/helper/echo-guard.mjs'), path.join(guardDir, 'index.mjs'));
  fs.writeFileSync(path.join(guardDir, 'openclaw.plugin.json'), JSON.stringify({ id: 'echo-guard', name: 'Echo guard', description: 'test',
    categories: ['other'], activation: { onStartup: true }, configSchema: { type: 'object', additionalProperties: false } }));
  fs.writeFileSync(path.join(guardDir, 'package.json'), JSON.stringify({ name: 'echo-guard', version: '1.0.0', type: 'module', openclaw: { extensions: ['./index.mjs'] } }));

  // The throwaway gateway: ECHO's agents, the test mail app for Echo · Friendly lab assistant only.
  const token = crypto.randomBytes(24).toString('hex');
  const agents = Object.fromEntries(registry.AVATAR_AGENTS.map(a => [a.agentId, {
    identity: { name: 'Echo' }, skills: [],
    tools: { allow: [...registry.TOOL_NAMES.map(t => registry.toolNameFor(a.slug, t)), ...(a.agentId === 'echo' ? ['testmail__*'] : [])],
      deny: ['exec', 'process', 'write', 'edit', 'apply_patch', 'browser', 'nodes', 'cron', 'canvas'], exec: { security: 'deny' }, codeMode: false },
  }]));
  const sets = [
    ['gateway.mode', 'local'], ['gateway.bind', 'loopback'], ['gateway.auth.mode', 'token'], ['gateway.auth.token', token],
    ['gateway.port', String(PORT), true], ['discovery.mdns.mode', 'off'], ['agents.defaults.heartbeat.every', '0m'],
    ['gateway.controlUi.allowedOrigins', JSON.stringify([`chrome-extension://${require('./extension-id.cjs').extensionId()}`]), true],
    ['tools.codeMode', 'false', true], ['tools.toolSearch', 'false', true], ['tools.agentToAgent.enabled', 'false', true],
    ['gateway.nodes.commands.allow', JSON.stringify(registry.allCommands()), true],
    ['plugins.load.paths', JSON.stringify([guardDir]), true], ['plugins.entries.echo-guard', JSON.stringify({ enabled: true }), true],
    ['mcp.servers.testmail', JSON.stringify({ command: process.execPath, args: [path.join(__dirname, 'fixtures/test-mail-mcp.mjs')], env: { TEST_MAIL_LOG: sentLog } }), true],
    ['models.providers.scripted', JSON.stringify({ baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'local', api: 'openai-completions',
      models: [{ id: 'script', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2000 }] }), true],
    ['agents.defaults.model', JSON.stringify({ primary: 'scripted/script' }), true],
  ];
  for (const [key, value, strict] of sets) oc('config', 'set', key, value, ...(strict ? ['--strict-json'] : []));
  oc('config', 'set', 'agents.entries', JSON.stringify(agents), '--strict-json', '--merge');
  const gateway = spawn(OPENCLAW, ['--profile', PROFILE, 'gateway', 'run'], { stdio: 'ignore', detached: true });
  children.push(gateway);
  const up = await waitFor(async () => { oc('health'); return true; }, 60_000, 1000);
  check('a throwaway gateway with Echo guard, a test mail app and a scripted model', !!up);

  // ECHO, pointed at it. The gateway approves ECHO here the way Echo Helper does.
  const echo = await launchEcho({ urls: ['https://example.com/'] });
  cleanup = echo.cleanup;
  const { cdp, extensionId } = echo;
  const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
  await findTarget(cdp, t => t.targetId === panelId);
  await delay(1000);
  const panel = expr => evaluate(cdp, panelId, expr);
  const msg = m => panel(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);
  await msg({ type: 'ECHO_OPENCLAW_SAVE', enabled: true, url: `ws://127.0.0.1:${PORT}`, sharedToken: token });
  const ready = await waitFor(async () => {
    for (const r of ocJson('devices', 'list').pending || []) try { oc('devices', 'approve', r.requestId); } catch { /* raced */ }
    const nodes = ocJson('nodes', 'pending');
    for (const r of nodes.pending || (Array.isArray(nodes) ? nodes : [])) try { oc('nodes', 'approve', r.requestId || r.id); } catch { /* raced */ }
    return (await msg({ type: 'ECHO_OPENCLAW_STATUS' })).status?.ready;
  }, 120_000, 2000);
  check('ECHO connects, allowed to answer approvals', !!ready);

  // Echo · Friendly lab assistant gets the example.com tab.
  const tab = await evaluate(cdp, echo.worker.targetId, `chrome.tabs.query({ url: 'https://example.com/*' }).then(t => t[0].id)`);
  const assigned = await msg({ type: 'ECHO_AGENT_ASSIGN', agent: 'echo', tabId: tab });
  check('an agent is given a tab', assigned?.success, assigned?.error);
  await panel(`(() => { const st = document.createElement('style'); st.textContent = '*{animation:none!important;transition:none!important}'; document.head.append(st); return true; })()`);

  const sent = () => (fs.existsSync(sentLog) ? fs.readFileSync(sentLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const approvalText = () => panel(`document.querySelector('.echo-approval')?.innerText || ''`);
  const press = async label => {
    const at = await panel(`(() => { const b = [...document.querySelectorAll('.echo-approval button')].find(b => b.innerText.trim() === ${JSON.stringify(label)});
      const r = b?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: panelId, flatten: true });
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, sessionId);
  };
  const thread = async () => ((await msg({ type: 'ECHO_AGENT_THREAD', agent: 'echo' })).messages || []);

  // 1. Allow: the email goes.
  await msg({ type: 'USER_INPUT', agent: 'echo', text: 'CALL testmail__send_email {"to":["bob@example.com"],"subject":"Lunch","body":"See you at noon"}' });
  const asked = await waitFor(async () => { const t = await approvalText(); return /Send an email to bob@example\.com/.test(t) && t; }, 60_000);
  check('the agent\'s send waits, and ECHO asks in the chat panel', !!asked, asked || await approvalText());
  check('the prompt names the app, not the web page', /with Test ?mail|with Testmail/i.test(asked || ''), asked);
  check('nothing is sent before the answer', sent().length === 0);
  if (process.env.SHOTS) {
    // For people reviewing the change: the prompt as the user sees it.
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: panelId, flatten: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 820, deviceScaleFactor: 2, mobile: false }, sessionId);
    await delay(500);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(path.join(process.env.SHOTS, 'approval-app.png'), Buffer.from(shot.data, 'base64'));
  }
  await press('Allow once');
  const went = await waitFor(async () => sent().length === 1 && sent()[0], 30_000);
  check('Allow once: the email is sent, as asked', went && went.to[0] === 'bob@example.com' && went.subject === 'Lunch', JSON.stringify(went));
  const reply1 = await waitFor(async () => (await thread()).filter(m => m.role === 'echo').at(-1)?.text?.match(/DONE: Sent/) && (await thread()).at(-1).text, 30_000);
  check('the agent reports it sent', !!reply1, reply1);

  // 2. Deny: nothing goes, and the agent hears no.
  await msg({ type: 'USER_INPUT', agent: 'echo', text: 'CALL testmail__send_email {"to":["eve@example.com"],"subject":"Secret","body":"Hi"}' });
  const asked2 = await waitFor(async () => /eve@example\.com/.test(await approvalText()), 60_000);
  check('a second send asks again', !!asked2);
  await press('Deny');
  await delay(3000);
  check('Deny: nothing is sent', sent().length === 1, JSON.stringify(sent().map(s => s.to)));
  const reply2 = await waitFor(async () => { const t = (await thread()).filter(m => m.role === 'echo').at(-1)?.text || ''; return /DONE:/.test(t) && !/Sent to/.test(t) && t; }, 30_000);
  check('the agent is told it was not allowed', !!reply2, reply2);

  // 3. Reading needs no approval.
  await msg({ type: 'USER_INPUT', agent: 'echo', text: 'CALL testmail__search_emails {"query":"lunch"}' });
  const read = await waitFor(async () => { const t = (await thread()).filter(m => m.role === 'echo').at(-1)?.text || ''; return /Lunch on Friday/.test(t) && t; }, 30_000);
  check('reading mail runs without asking', !!read && !(await approvalText()), read);

  // 4. Only the agents given the app can use it.
  const second = await evaluate(cdp, echo.worker.targetId, `chrome.tabs.create({ url: 'https://example.org/' }).then(t => t.id)`);
  await waitFor(() => evaluate(cdp, echo.worker.targetId, `chrome.tabs.get(${second}).then(t => /^https:/.test(t.url || ''))`), 15_000);
  const other = await msg({ type: 'ECHO_AGENT_ASSIGN', agent: 'echo-style', tabId: second });
  await delay(1500);
  await msg({ type: 'USER_INPUT', agent: 'echo-style', text: 'CALL testmail__send_email {"to":["bob@example.com"],"subject":"x","body":"y"}' });
  const refused = await waitFor(async () => { const t = ((await msg({ type: 'ECHO_AGENT_THREAD', agent: 'echo-style' })).messages || []).filter(m => m.role === 'echo').at(-1)?.text || ''; return /NO TOOL testmail__send_email/.test(t) && t; }, 30_000);
  check('an agent not given the app never sees its tools', other?.success && !!refused,
    refused || other?.error || JSON.stringify(((await msg({ type: 'ECHO_AGENT_THREAD', agent: 'echo-style' })).messages || []).slice(-2)));

  cdp.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nApprovals e2e failed:', error.stack || error.message); process.exit(1); });
