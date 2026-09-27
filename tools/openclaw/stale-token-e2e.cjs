#!/usr/bin/env node
// ECHO's saved device token can go stale (rotated or re-issued on the gateway,
// for example while setting up again). ECHO must forget it and get back in with
// the gateway's key, instead of stopping. Uses ECHO's real connection code and
// a throwaway gateway profile (never ECHO's own); no browser, no model.
//
//   node tools/openclaw/stale-token-e2e.cjs

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);
const { createGatewayConnection } = require(path.join(ROOT, 'src/background/openclaw/connection.ts'));
const { deviceIdentity } = require(path.join(ROOT, 'src/background/openclaw/identity.ts'));
const { extensionId } = require('./extension-id.cjs');

const OPENCLAW = path.join(os.homedir(), '.npm-global/bin/openclaw');
const PROFILE = 'echo-e2e-token';
const PORT = 18804;
const ORIGIN = `chrome-extension://${extensionId()}`;
const SCOPES = ['operator.read', 'operator.write', 'operator.approvals'];
const oc = (...args) => execFileSync(OPENCLAW, ['--profile', PROFILE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ocJson = (...args) => JSON.parse(oc(...args, '--json').replace(/^[^{[]*/, ''));
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };

// One fresh device for this run, its tokens kept in memory like ECHO keeps them in storage.
let pair;
const keyStore = { load: async () => (pair ||= await crypto.webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])), save: async () => {} };
const tokens = {};
const tokenStore = { load: p => tokens[p.role] || null, store: p => { tokens[p.role] = { token: p.token, scopes: p.scopes }; }, clear: p => { delete tokens[p.role]; } };

function connect(sharedToken) {
  return new Promise(resolve => {
    const states = [];
    let done = false;
    const conn = createGatewayConnection({
      url: `ws://127.0.0.1:${PORT}`, role: 'operator', identity: () => deviceIdentity(keyStore), tokenStore, sharedToken, scopes: SCOPES,
      client: { id: 'webchat-ui', mode: 'webchat', version: '2.0.0', platform: 'chrome', displayName: 'ECHO' }, caps: ['tool-events', 'plugin-approvals'],
      createWebSocket: url => new WebSocket(url, { headers: { Origin: ORIGIN } }),
      onState: s => {
        if (done) return;
        states.push(s.kind + (s.code ? `:${s.code}` : ''));
        // The gateway approves this device the way Echo Helper does.
        if (s.kind === 'pairing-required') for (const r of ocJson('devices', 'list').pending || []) try { oc('devices', 'approve', r.requestId); } catch { /* raced */ }
        if (s.kind === 'connected') { done = true; conn.stop(); resolve({ ok: true, scopes: s.hello.auth?.scopes || [], states }); }
      },
    });
    conn.start();
    setTimeout(() => { if (!done) { done = true; conn.stop(); resolve({ ok: false, states }); } }, 30_000);
  });
}

async function main() {
  const stateDir = path.join(os.homedir(), `.openclaw-${PROFILE}`);
  fs.rmSync(stateDir, { recursive: true, force: true });
  const token = crypto.randomBytes(24).toString('hex');
  for (const [key, value, strict] of [['gateway.mode', 'local'], ['gateway.bind', 'loopback'], ['gateway.auth.mode', 'token'], ['gateway.auth.token', token],
    ['gateway.port', String(PORT), true], ['gateway.controlUi.allowedOrigins', JSON.stringify([ORIGIN]), true], ['discovery.mdns.mode', 'off']]) {
    oc('config', 'set', key, value, ...(strict ? ['--strict-json'] : []));
  }
  const gateway = spawn(OPENCLAW, ['--profile', PROFILE, 'gateway', 'run'], { stdio: 'ignore', detached: true });
  // The gateway runs as a child of its launcher: stop the whole group.
  process.on('exit', () => {
    try { process.kill(-gateway.pid); } catch { /* gone */ }
    // Let the gateway finish writing as it stops, then remove its profile.
    try { execFileSync('/bin/sleep', ['2']); } catch { /* fine */ }
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
  for (let i = 0; i < 60; i++) { try { oc('health'); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }

  const first = await connect(token);
  check('ECHO pairs with the gateway\'s key and may answer approvals', first.ok && SCOPES.every(s => first.scopes.includes(s)), first.states.join(' → '));
  const again = await connect(undefined);
  check('it reconnects with its device token alone', again.ok, again.states.join(' → '));

  const device = (ocJson('devices', 'list').paired || [])[0];
  oc('devices', 'rotate', '--device', device.deviceId, '--role', 'operator', ...SCOPES.flatMap(s => ['--scope', s]), '--json');
  const recovered = await connect(token);
  check('a stale token is forgotten and ECHO gets back in with the key', recovered.ok && recovered.states.some(s => /DEVICE_TOKEN_MISMATCH/.test(s)),
    recovered.states.join(' → '));

  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nStale token e2e failed:', error.stack || error.message); process.exit(1); });
