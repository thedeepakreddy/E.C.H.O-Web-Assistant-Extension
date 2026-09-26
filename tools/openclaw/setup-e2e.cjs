#!/usr/bin/env node
// One-command setup, end to end: a fresh ECHO (headless Chrome for Testing)
// prepares the setup command, the command runs as the user would run it in a
// terminal, and ECHO becomes ready with no token copied and nothing approved
// by hand. The command rewrites ECHO's gateway profile and restarts the
// gateway service; ECHOs already paired stay paired and reconnect.
//
//   npm run build && node tools/openclaw/setup-e2e.cjs
// Needs OpenClaw installed with a model already configured (the command would
// otherwise stop to ask for an API key).

const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchEcho, evaluate, findTarget, delay } = require('../e2e/chrome.cjs');

const OPENCLAW = path.join(os.homedir(), '.npm-global/bin/openclaw');
const oc = (...args) => execFileSync(OPENCLAW, ['--profile', 'echo', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ocJson = (...args) => { const out = oc(...args, '--json'); return JSON.parse(out.slice(out.search(/[[{]/))); };
const tryOc = (...args) => { try { oc(...args); return true; } catch { return false; } };
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`); };

async function waitFor(fn, timeoutMs, stepMs = 1000) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(stepMs)) {
    const value = await fn().catch(() => null);
    if (value) return value;
  }
  return null;
}

async function main() {
  const known = new Set((ocJson('devices', 'list').paired || []).map(d => d.deviceId));
  const { cdp, extensionId, worker, cleanup } = await launchEcho({ urls: ['https://example.com/'] });
  let device = null;
  process.on('exit', () => { if (device && !known.has(device)) tryOc('devices', 'remove', device); cleanup(); });
  const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
  await findTarget(cdp, t => t.targetId === panelId);
  await delay(1000);
  const panel = msg => evaluate(cdp, panelId, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
  const status = () => panel({ type: 'ECHO_OPENCLAW_STATUS' }).then(r => r.status);

  const prepared = await panel({ type: 'ECHO_OPENCLAW_SETUP_COMMAND' });
  const command = prepared?.command || '';
  check('ECHO prepares one command and turns agent mode on', prepared?.success && /^bash -c "\$\(echo '[A-Za-z0-9+/=]+' \| base64 --decode \| gunzip\)"$/.test(command)
    && (await status()).enabled, `${command.length} characters`);
  // The device id is in the command's script: it approves exactly this ECHO.
  device = (prepared.script.match(/nodes describe --node ([0-9a-f]+)/) || [])[1] || null;
  check('the command approves exactly this ECHO', !!device && !known.has(device), device?.slice(0, 12));
  check('the command carries no API key; it asks for one in the terminal only when none is set',
    !/\b(AIza|sk-|AQ\.)[A-Za-z0-9_-]{10,}/.test(prepared.script) && /models auth paste-api-key/.test(prepared.script));

  const started = Date.now();
  let output = '';
  try {
    output = execFileSync('bash', ['-c', command], { encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, PATH: `${path.dirname(OPENCLAW)}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    output = `${error.stdout || ''}${error.stderr || ''}`;
  }
  check('the command finishes by itself and says so', /your avatars are ready/.test(output),
    `${Math.round((Date.now() - started) / 1000)}s · ${output.trim().split('\n').filter(Boolean).slice(-1)[0] || '(no output)'}`);

  const ready = await waitFor(async () => { const s = await status(); return s.ready ? s : null; }, 60_000);
  check('ECHO is ready: nothing copied, nothing approved by hand', !!ready, ready ? `OpenClaw ${ready.serverVersion}` : JSON.stringify(await status()).slice(0, 160));
  const tokenGone = await waitFor(async () => !(await status()).hasToken, 15_000);
  check('ECHO forgets the setup token once paired', !!tokenGone);

  // The side panel says so, in plain words.
  await evaluate(cdp, panelId, `document.querySelector('.echo-agents-pill')?.click(); true`);
  await delay(800);
  const words = await evaluate(cdp, panelId, `document.querySelector('.echo-mode-row')?.innerText || ''`);
  check('the side panel shows agent mode on', /Agent mode is on/.test(words), words.replace(/\s+/g, ' '));

  cdp.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nSetup e2e failed:', error.stack || error.message); process.exit(1); });
