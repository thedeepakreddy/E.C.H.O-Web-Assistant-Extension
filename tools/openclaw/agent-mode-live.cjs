// Agent mode in a test browser, as a person turns it on: Echo Helper's one-time
// install (run with HOME pointed at a temp folder, so the real browsers' folders
// are never touched; the test browser is shown the helper through its own
// profile), then Turn on. Shared by the live e2e tests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluate, delay } = require('../e2e/chrome.cjs');

const OPENCLAW = path.join(os.homedir(), '.npm-global/bin/openclaw');
const oc = (...args) => execFileSync(OPENCLAW, ['--profile', 'echo', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ocJson = (...args) => { const out = oc(...args, '--json'); return JSON.parse(out.slice(out.search(/[[{]/))); };
const tryOc = (...args) => { try { oc(...args); return true; } catch { return false; } };

const pairedDevices = () => { try { return (ocJson('devices', 'list').paired || []).map(d => d.deviceId); } catch { return []; } };

/**
 * Remember the gateway's paired devices; the returned function removes any the
 * test added and makes sure the gateway is running again (other ECHOs use it).
 */
function keepGatewayTidy() {
  const known = new Set(pairedDevices());
  return () => {
    for (const id of pairedDevices()) if (!known.has(id)) tryOc('devices', 'remove', id);
    if (!tryOc('health')) tryOc('daemon', 'install', '--force');
  };
}

/** Install Echo Helper for this test browser and turn agent mode on. Resolves to the OpenClaw status once ready. */
async function turnOnAgentMode({ cdp, panelId, userDir, timeoutMs = 180_000 }) {
  const panel = expr => evaluate(cdp, panelId, expr);
  const first = await panel(`chrome.runtime.sendMessage({ type: 'ECHO_AGENT_MODE', action: 'turn-on' })`);
  if (first?.needsHelper) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-home-'));
    try {
      fs.mkdirSync(path.join(home, 'Library/Application Support/Google/Chrome'), { recursive: true });
      execFileSync('bash', ['-c', first.command], { stdio: 'ignore', timeout: 300_000,
        env: { ...process.env, HOME: home, OPENCLAW, PATH: `${path.dirname(OPENCLAW)}:${process.env.PATH}` } });
      fs.mkdirSync(path.join(userDir, 'NativeMessagingHosts'), { recursive: true });
      fs.copyFileSync(path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.echo.helper.json'),
        path.join(userDir, 'NativeMessagingHosts/com.echo.helper.json'));
    } finally {
      // The helper program stays in the temp folder only while the test runs.
      process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
    }
    const on = await panel(`chrome.runtime.sendMessage({ type: 'ECHO_AGENT_MODE', action: 'turn-on' })`);
    if (!on?.ok) throw new Error(`Turn on failed: ${JSON.stringify(on)}`);
  } else if (!first?.ok) {
    throw new Error(`Turn on failed: ${JSON.stringify(first)}`);
  }
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(1000)) {
    const status = (await panel(`chrome.runtime.sendMessage({ type: 'ECHO_OPENCLAW_STATUS' })`))?.status;
    if (status?.ready) return status;
  }
  throw new Error('Agent mode did not come on.');
}

module.exports = { OPENCLAW, oc, ocJson, tryOc, keepGatewayTidy, turnOnAgentMode };
