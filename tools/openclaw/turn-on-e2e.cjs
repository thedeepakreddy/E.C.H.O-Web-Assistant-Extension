#!/usr/bin/env node
// Agent mode from buttons, end to end, the way a person does it: press Turn on
// in the chat panel, copy the one-time install command it shows, run it, and
// ECHO carries on by itself until agents are on. Then Turn off and Turn on again
// from the Echo panel on the page, with no terminal at all.
//
//   npm run build && node tools/openclaw/turn-on-e2e.cjs
// Needs OpenClaw installed with a model already configured. The install runs
// with HOME pointed at a temp folder, so it never touches the real browsers'
// folders; Chrome for Testing is shown the helper through its own profile. Turn
// on rewrites ECHO's gateway profile and restarts the gateway service; ECHOs
// already paired stay paired and reconnect. The test's own device is removed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchEcho, evaluate, findTarget, delay } = require('../e2e/chrome.cjs');

const OPENCLAW = require('./bin.cjs').findOpenClaw();
const oc = (...args) => execFileSync(OPENCLAW, ['--profile', 'echo', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ocJson = (...args) => { const out = oc(...args, '--json'); return JSON.parse(out.slice(out.search(/[[{]/))); };
const tryOc = (...args) => { try { oc(...args); return true; } catch { return false; } };
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`); };

async function waitFor(fn, timeoutMs, stepMs = 500) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(stepMs)) {
    const value = await fn().catch(() => null);
    if (value) return value;
  }
  return null;
}

async function main() {
  let paired = [];
  try { paired = ocJson('devices', 'list').paired || []; } catch { /* turn-on starts the gateway below */ }
  const known = new Set(paired.map(d => d.deviceId));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-home-'));
  fs.mkdirSync(path.join(home, 'Library/Application Support/Google/Chrome'), { recursive: true });
  const { cdp, extensionId, worker, userDir, cleanup } = await launchEcho({ urls: ['https://example.com/'] });
  // Removes the test's device, puts back the gateway's Echo guard settings and
  // makes sure the gateway runs again (other ECHOs on this computer use it).
  const tidy = require('./agent-mode-live.cjs').keepGatewayTidy();
  process.on('exit', () => {
    tidy();
    cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const inWorker = expr => evaluate(cdp, worker.targetId, expr);
  const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
  await findTarget(cdp, t => t.targetId === panelId);
  await delay(1200);
  const panel = expr => evaluate(cdp, panelId, expr);
  const status = () => panel(`chrome.runtime.sendMessage({ type: 'ECHO_OPENCLAW_STATUS' }).then(r => r.status)`);
  // Watch what the panel says while it works, and catch what "Copy" puts on the clipboard.
  await panel(`(() => {
    window.__seen = []; window.__copied = '';
    navigator.clipboard.writeText = text => { window.__copied = text; return Promise.resolve(); };
    setInterval(() => { const t = document.querySelector('.echo-sheet .agent-working small, .echo-mode-row small')?.innerText;
      if (t && window.__seen.at(-1) !== t) window.__seen.push(t); }, 200);
    return true; })()`);

  // 1. Assign Agent → Turn on. Echo Helper is not installed yet: ECHO shows the one-time install.
  await panel(`document.querySelector('.echo-agents-pill').click(); true`);
  await delay(800);
  await panel(`[...document.querySelectorAll('.echo-mode-row button')].find(b => /Turn on/.test(b.textContent)).click(); true`);
  const install = await waitFor(() => panel(`!!document.querySelector('.agent-steps') && document.querySelector('.echo-sheet')?.innerText`), 15_000);
  check('Turn on without the helper shows the one-time install', /One time only/.test(install || ''), (install || '').split('\n')[0]);
  await panel(`[...document.querySelectorAll('.agent-steps button')].find(b => /Copy command/.test(b.textContent)).click(); true`);
  const command = await waitFor(() => panel(`window.__copied`), 5_000);
  check('Copy gives one command to paste', /^bash -c "\$\(echo '[A-Za-z0-9+/=]+' \| base64 --decode \| gunzip\)"$/.test(command || ''), `${(command || '').length} characters`);

  // 2. The person pastes it in Terminal.
  let output = '';
  try {
    output = execFileSync('bash', ['-c', command], { encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, OPENCLAW, PATH: `${path.dirname(OPENCLAW)}:${process.env.PATH}` } });
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
  }
  check('the install finishes and says what to do next', /Go back to Chrome and press Turn on/.test(output), output.trim().split('\n').filter(Boolean).slice(-1)[0]);
  const manifestFile = path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.echo.helper.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  check('only this ECHO may start the helper', JSON.stringify(manifest.allowed_origins) === JSON.stringify([`chrome-extension://${extensionId}/`]));
  // Chrome for Testing reads helpers from its own profile folder.
  fs.mkdirSync(path.join(userDir, 'NativeMessagingHosts'), { recursive: true });
  fs.copyFileSync(manifestFile, path.join(userDir, 'NativeMessagingHosts/com.echo.helper.json'));

  // 3. ECHO notices the helper and carries on by itself, to "Agent mode is on".
  const started = Date.now();
  const on = await waitFor(async () => (await panel(`document.querySelector('.echo-sheet')?.innerText || ''`)).includes('Agent mode is on') && (await status()).ready, 180_000, 1000);
  const seen = await panel(`window.__seen`);
  check('ECHO carries on by itself and agent mode comes on', !!on, `${Math.round((Date.now() - started) / 1000)}s`);
  check('the panel shows each step in plain words', ['Setting up your agents', 'Starting OpenClaw', 'Connecting ECHO'].every(s => seen.includes(s)), seen.join(' → '));

  // 4. The Echo panel on the page says so too.
  const pageTarget = await findTarget(cdp, t => t.type === 'page' && /example\.com/.test(t.url));
  const tab = await inWorker(`chrome.tabs.query({ url: 'https://example.com/*' }).then(t => t[0].id)`);
  // Bring the page to the front: background tabs slow timers, and a long press is a timer.
  await inWorker(`chrome.tabs.update(${tab}, { active: true }).then(() => true)`);
  await inWorker(`chrome.storage.session.set({ isEchoAwake: true }).then(() => chrome.tabs.sendMessage(${tab}, { type: 'ECHO_GLOBAL_WAKE', state: true })).then(() => true, () => true)`);
  await delay(1500);
  const page = expr => evaluate(cdp, pageTarget.targetId, expr);
  const center = await page(`(() => { const r = document.querySelector('#echo-root-wrapper').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  const press = async ms => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 }, sessionId);
    await delay(ms);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', clickCount: 1 }, sessionId);
  };
  await press(900);   // long press opens the Echo panel
  const opened = await waitFor(() => page(`document.querySelector('#echo-chat-box')?.classList.contains('visible')`), 5_000, 200);
  check('a long press on the avatar opens the Echo panel', !!opened);
  const agentButton = () => page(`document.querySelector('#echo-root-wrapper .cmd-agent')?.innerText || ''`);
  const onLabel = await waitFor(async () => /Agents on/.test(await agentButton()) && agentButton(), 10_000);
  check('the Echo panel shows "Agents on"', !!onLabel, onLabel || await agentButton());
  const headButtons = await page(`[...document.querySelectorAll('#echo-root-wrapper .cmd-head button')].map(b => b.getAttribute('aria-label') || b.innerText.trim())`);
  check('the Echo panel has chat panel and settings buttons', headButtons.includes('Open the chat panel') && headButtons.includes('Settings'), headButtons.join(', '));

  // 5. Turn off in the chat panel: the gateway service stops, and ECHO says agent mode is off.
  await panel(`[...document.querySelectorAll('.echo-mode-row button')].find(b => /Details/.test(b.textContent))?.click(); true`);
  await delay(500);
  await panel(`[...document.querySelectorAll('.agent-secondary')].find(b => /Turn off/.test(b.textContent)).click(); true`);
  const off = await waitFor(async () => !(await status()).enabled && !tryOc('health'), 60_000, 1000);
  check('Turn off stops OpenClaw and agent mode is off', !!off);
  const offLabel = await waitFor(async () => /Turn on agents/.test(await agentButton()) && agentButton(), 15_000);
  check('the Echo panel offers "Turn on agents" again', !!offLabel, offLabel || await agentButton());

  // 6. Turn on again from the Echo panel: no terminal, no chat panel.
  const again = Date.now();
  await page(`document.querySelector('#echo-root-wrapper .cmd-agent').click(); true`);
  const busy = await waitFor(async () => /Turning on/.test(await agentButton()), 10_000, 200);
  check('the Echo panel shows it is turning on', !!busy);
  const onAgain = await waitFor(async () => (await status()).ready && /Agents on/.test(await agentButton()), 180_000, 1000);
  check('Turn on from the Echo panel brings agents back', !!onAgain, onAgain ? `${Math.round((Date.now() - again) / 1000)}s`
    : `${Math.round((Date.now() - again) / 1000)}s; ECHO: ${JSON.stringify(await status()).slice(0, 400)}`);

  cdp.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nTurn on e2e failed:', error.stack || error.message); process.exit(1); });
