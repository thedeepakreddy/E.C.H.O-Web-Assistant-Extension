const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// Echo Helper: the small program ECHO's "Turn on" button talks to. It must
// refuse anything but checked setup data, keep ECHO's agents locked down, and
// speak Chrome's native messaging protocol. OpenClaw is replaced by a fake that
// records every command, so no real gateway is touched.

const HELPER = path.join(__dirname, '..', 'src/helper/echo-helper.mjs');
const ORIGIN = 'chrome-extension://ajppdcdcnfnnbjfkkoamikimkefjdhee/';
const DEVICE = 'ab'.repeat(32);
const load = () => import(pathToFileURL(HELPER).href);

const validRequest = () => ({
  token: 'cd'.repeat(24), deviceId: DEVICE,
  setup: {
    commands: ['echo.analyst.observe', 'echo.analyst.act'],
    agents: [{ agentId: 'echo-analyst', allow: ['analyst_observe', 'analyst_act'], files: { 'AGENTS.md': '# rules', 'SOUL.md': 'soul', 'IDENTITY.md': 'id' } }],
  },
});

test('helper: only checked setup data is accepted', async () => {
  const { checkSetup } = await load();
  assert.doesNotThrow(() => checkSetup(validRequest()));
  const bad = (change, message) => {
    const req = validRequest();
    change(req);
    assert.throws(() => checkSetup(req), message);
  };
  bad(r => { r.token = 'x; rm -rf ~'; }, /Bad token/);
  bad(r => { r.deviceId = '../../etc'; }, /Bad device id/);
  bad(r => { r.setup.commands.push('system.run'); }, /Bad command list/);
  bad(r => { r.setup.agents[0].agentId = '../main'; }, /Bad agent id/);
  bad(r => { r.setup.agents[0].allow.push('exec'); }, /Bad tool list/);
  bad(r => { r.setup.agents[0].files['../../.zshrc'] = 'x'; }, /Bad workspace file/);
  bad(r => { r.ai = { provider: 'evil', key: 'abcdefgh1234' }; }, /Unknown AI provider/);
  bad(r => { r.ai = { provider: 'google', key: 'short' }; }, /does not look right/);
});

test('helper: agents are always locked down, whatever was asked', async () => {
  const { agentEntries } = await load();
  const entry = agentEntries([{ agentId: 'echo-style', allow: ['style_observe'] }])['echo-style'];
  assert.deepEqual(entry.skills, []);
  assert.equal(entry.tools.codeMode, false);
  assert.deepEqual(entry.tools.exec, { security: 'deny' });
  for (const tool of ['exec', 'write', 'browser', 'nodes']) assert.ok(entry.tools.deny.includes(tool), tool);
});

/** A fake OpenClaw: records each call, answers like a gateway where ECHO connects once approved. */
function fakeOpenClaw() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-test-'));
  const log = path.join(dir, 'calls.log');
  const approved = path.join(dir, 'approved');
  const bin = path.join(dir, 'openclaw');
  fs.writeFileSync(bin, `#!/bin/bash
args="$*"
if [ ! -t 0 ] && [[ "$args" == *paste-api-key* ]]; then read -r key; echo "KEY:$key" >> "${dir}/keys.log"; fi
echo "$args" >> "${log}"
case "$args" in
  *"--version"*) echo "OpenClaw 2026.9.6 (test)";;
  *"models status --json"*) echo '{"defaultModel":"google/gemini-3.8-flash","auth":{"providers":[{"provider":"google","profiles":{"count":1}}]}}';;
  *"health"*) exit 0;;
  *"devices list --json"*) [ -f "${approved}" ] && echo '{"pending":[]}' || echo '{"pending":[{"deviceId":"${DEVICE}","requestId":"req-1"}]}';;
  *"devices approve req-1"*) touch "${approved}";;
  *"nodes pending --json"*) echo '{"pending":[]}';;
  *"config get agents.entries"*) echo '{"echo":{"tools":{"allow":["echo_observe","echo_act"]}},"echo-style":{"tools":{"allow":["style_observe","echo-mail__*"]}},"main":{"tools":{}}}';;
  *"nodes describe"*) [ -f "${approved}" ] && echo '{"connected":true,"approvalState":"approved"}' || echo '{"connected":false}';;
esac
exit 0
`, { mode: 0o755 });
  return { dir, bin, calls: () => fs.readFileSync(log, 'utf8').trim().split('\n'), keys: () => (fs.existsSync(path.join(dir, 'keys.log')) ? fs.readFileSync(path.join(dir, 'keys.log'), 'utf8') : '') };
}

/** Run the helper as Chrome does, and exchange framed messages with it. */
function talk(env, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER, ORIGIN], { env: { ...process.env, ...env, HOME: env.HOME || process.env.HOME } });
    const replies = [];
    let buffer = Buffer.alloc(0);
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const n = buffer.readUInt32LE(0);
        replies.push(JSON.parse(buffer.subarray(4, 4 + n).toString()));
        buffer = buffer.subarray(4 + n);
      }
    });
    child.on('error', reject);
    child.on('exit', () => resolve(replies));
    for (const m of messages) {
      const body = Buffer.from(JSON.stringify(m));
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([head, body]));
    }
    child.stdin.end();
  });
}

test('helper: speaks native messaging and reports what is installed', async () => {
  const fake = fakeOpenClaw();
  const replies = await talk({ OPENCLAW: fake.bin }, [{ id: 7, cmd: 'hello' }]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 7);
  assert.deepEqual(replies[0].result.openclaw, { version: '2026.9.6' });
  assert.equal(replies[0].result.running, true);
  assert.equal(replies[0].result.model, 'google/gemini-3.8-flash');
});

test('helper: starts when reached through a symlinked folder (macOS /var is /private/var)', async () => {
  const fake = fakeOpenClaw();
  const link = path.join(fake.dir, 'linked-helper.mjs');
  fs.symlinkSync(HELPER, link);
  const replies = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [link, ORIGIN], { env: { ...process.env, OPENCLAW: fake.bin } });
    const chunks = [];
    child.stdout.on('data', c => chunks.push(c));
    child.on('error', reject);
    child.on('exit', () => resolve(Buffer.concat(chunks)));
    const body = Buffer.from(JSON.stringify({ id: 3, cmd: 'hello' }));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    child.stdin.end(Buffer.concat([head, body]));
  });
  assert.ok(replies.length > 4, 'the helper answered');
  assert.equal(JSON.parse(replies.subarray(4).toString()).id, 3);
});

test('helper: Turn on configures, starts OpenClaw and approves exactly this ECHO; the key goes in by stdin', async () => {
  const fake = fakeOpenClaw();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-home-'));
  const request = { id: 1, cmd: 'turn-on', ...validRequest(), ai: { provider: 'google', key: 'test-key-not-real-1234' } };
  const replies = await talk({ OPENCLAW: fake.bin, HOME: home }, [request]);
  const final = replies.at(-1);
  assert.deepEqual(final.result, { ok: true }, JSON.stringify(final));
  assert.deepEqual(replies.filter(r => r.progress).map(r => r.progress),
    ['Setting up your agents', 'Saving your AI key', 'Starting OpenClaw', 'Connecting ECHO']);
  assert.ok(replies.find(r => r.progress === 'Connecting ECHO').started, 'ECHO is told to connect as soon as OpenClaw is up');
  const calls = fake.calls();
  assert.ok(calls.includes(`--profile echo config set gateway.controlUi.allowedOrigins ["chrome-extension://ajppdcdcnfnnbjfkkoamikimkefjdhee"] --strict-json`),
    'only the calling ECHO may connect');
  assert.ok(calls.some(c => c.startsWith('--profile echo config set agents.entries') && c.includes('"codeMode":false')));
  assert.ok(calls.includes('--profile echo daemon install --force'));
  assert.ok(calls.includes('--profile echo devices approve req-1'));
  assert.equal(fake.keys().trim(), 'KEY:test-key-not-real-1234', 'the key is read from stdin');
  assert.ok(!calls.some(c => c.includes('test-key-not-real')), 'the key never appears in a command line');
  const agents = fs.readFileSync(path.join(home, '.openclaw-echo/workspace-echo-analyst/AGENTS.md'), 'utf8');
  assert.equal(agents, '# rules');
});

test('helper: refuses callers that are not an extension, and unknown requests', async () => {
  const fake = fakeOpenClaw();
  const child = await new Promise(resolve => {
    const replies = [];
    const p = spawn(process.execPath, [HELPER, 'https://evil.example/'], { env: { ...process.env, OPENCLAW: fake.bin } });
    let buffer = Buffer.alloc(0);
    p.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const n = buffer.readUInt32LE(0); replies.push(JSON.parse(buffer.subarray(4, 4 + n).toString())); buffer = buffer.subarray(4 + n);
      }
    });
    p.on('exit', () => resolve(replies));
    for (const m of [{ id: 1, cmd: 'turn-on', ...validRequest() }, { id: 2, cmd: 'run', command: 'rm -rf ~' }]) {
      const body = Buffer.from(JSON.stringify(m)); const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
      p.stdin.write(Buffer.concat([head, body]));
    }
    p.stdin.end();
  });
  const byId = Object.fromEntries(child.map(r => [r.id, r]));
  assert.match(byId[1].error, /Unknown caller/);
  assert.match(byId[2].error, /Unknown request/);
  assert.ok(!fs.existsSync(path.join(fake.dir, 'calls.log')), 'nothing was run');
});

test('helper: connecting email keeps the app password in a private file, never on a command line', async () => {
  const fake = fakeOpenClaw();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-apps-'));
  // A stand-in email app whose sign-in check always passes.
  fs.writeFileSync(path.join(home, 'echo-mail.mjs'), 'console.log(JSON.stringify({ ok: true }));');
  fs.mkdirSync(path.join(home, 'echo-guard'));
  fs.writeFileSync(path.join(home, 'echo-guard', 'index.mjs'), 'export default {};');
  const env = { OPENCLAW: fake.bin, ECHO_HELPER_HOME: home };
  const replies = await talk(env, [
    { id: 1, cmd: 'connect-app', app: 'mail', provider: 'gmail', address: 'me@gmail.com', password: 'abcd efgh ijkl mnop', agents: ['echo', 'echo-style'] },
    { id: 2, cmd: 'connect-app', app: 'mail', provider: 'gmail', address: 'not-an-address', password: 'abcdefghijkl' },
  ]);
  const byId = Object.fromEntries(replies.map(r => [r.id, r]));
  assert.deepEqual(byId[1].result, { ok: true, account: 'me@gmail.com', agents: ['echo', 'echo-style'] }, JSON.stringify(byId[1]));
  assert.match(byId[2].error, /email address does not look right/);
  const cred = path.join(home, 'apps', 'mail.json');
  assert.equal(fs.statSync(cred).mode & 0o777, 0o600, 'only the user can read it');
  const saved = JSON.parse(fs.readFileSync(cred, 'utf8'));
  assert.equal(saved.password, 'abcdefghijklmnop', 'spaces in the app password are dropped');
  assert.equal(saved.imap.host, 'imap.gmail.com');
  const calls = fake.calls();
  assert.ok(!calls.some(c => c.includes('abcdefghijklmnop') || c.includes('abcd efgh')), 'the password never appears in a command');
  const server = calls.find(c => c.includes('config set mcp.servers.echo-mail'));
  assert.ok(server && server.includes('echo-mail.mjs') && server.includes('ECHO_MAIL_CONFIG'), server);
  assert.ok(calls.some(c => c.includes('config set plugins.entries.echo-guard {"enabled":true}')), 'Echo guard is on');
  assert.ok(calls.includes('--profile echo config set agents.entries.echo.tools.allow ["echo_observe","echo_act","echo-mail__*"] --strict-json'),
    'each chosen agent keeps its browser tools and gets the app');
  assert.ok(calls.includes('--profile echo config set agents.entries.echo-style.tools.allow ["style_observe","echo-mail__*"] --strict-json'));
});

test('helper: app requests from anything but an extension are refused', async () => {
  const fake = fakeOpenClaw();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-helper-apps-'));
  const replies = await new Promise(resolve => {
    const out = [];
    const p = spawn(process.execPath, [HELPER, 'https://evil.example/'], { env: { ...process.env, OPENCLAW: fake.bin, ECHO_HELPER_HOME: home } });
    let buffer = Buffer.alloc(0);
    p.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const n = buffer.readUInt32LE(0); out.push(JSON.parse(buffer.subarray(4, 4 + n).toString())); buffer = buffer.subarray(4 + n);
      }
    });
    p.on('exit', () => resolve(out));
    for (const m of [{ id: 1, cmd: 'connect-app', app: 'mail', provider: 'gmail', address: 'me@gmail.com', password: 'abcdefghijkl' },
      { id: 2, cmd: 'disconnect-app', app: 'mail' }, { id: 3, cmd: 'app-agents', app: 'mail', agents: [] }]) {
      const body = Buffer.from(JSON.stringify(m)); const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
      p.stdin.write(Buffer.concat([head, body]));
    }
    p.stdin.end();
  });
  for (const r of replies) assert.match(r.error, /Unknown caller/, JSON.stringify(r));
  assert.ok(!fs.existsSync(path.join(home, 'apps', 'mail.json')));
});
