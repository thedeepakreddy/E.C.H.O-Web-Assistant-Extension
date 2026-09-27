const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

// ECHO as an MCP server for Claude Desktop and Claude Code: Claude starts
// echo-mcp, which reaches ECHO through Echo Helper's socket (only this user
// can open it); ECHO answers. The helper also adds echo-mcp to Claude's apps.

const HELPER = path.join(__dirname, '..', 'src/helper/echo-helper.mjs');
const MCP = path.join(__dirname, '..', 'src/helper/echo-mcp.mjs');
const ORIGIN = 'chrome-extension://ajppdcdcnfnnbjfkkoamikimkefjdhee/';
// Unix socket paths are short, so these live in /tmp; removed when the tests end.
const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const shortDir = () => { const d = fs.mkdtempSync('/tmp/echo-t-'); made.push(d); return d; };

function frame(m) {
  const body = Buffer.from(JSON.stringify(m));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

/** Echo Helper as Chrome runs it, kept open like ECHO's bridge port. */
function helperSession(env) {
  const child = spawn(process.execPath, [HELPER, ORIGIN], { env: { ...process.env, ...env } });
  const messages = [];
  const waiters = [];
  let buffer = Buffer.alloc(0);
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const n = buffer.readUInt32LE(0);
      const m = JSON.parse(buffer.subarray(4, 4 + n).toString());
      buffer = buffer.subarray(4 + n);
      messages.push(m);
      for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    }
  });
  return {
    send: m => child.stdin.write(frame(m)),
    next: match => new Promise(resolve => { const hit = messages.find(match); if (hit) resolve(hit); else waiters.push({ match, resolve }); }),
    close: () => new Promise(resolve => { child.on('exit', resolve); child.stdin.end(); }),
  };
}

function socketClient(socketPath) {
  const conn = net.createConnection(socketPath);
  const lines = [];
  const waiters = [];
  let buffer = '';
  conn.setEncoding('utf8');
  conn.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      lines.push(m);
      for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    }
  });
  return {
    ready: new Promise(r => conn.on('connect', r)),
    send: m => conn.write(`${JSON.stringify(m)}\n`),
    next: match => new Promise(resolve => { const hit = lines.find(match); if (hit) resolve(hit); else waiters.push({ match, resolve }); }),
    end: () => conn.end(),
  };
}

test('bridge: Claude\'s calls reach ECHO and its answers come back, through a socket only this user can open', async () => {
  const dir = shortDir();
  const socket = path.join(dir, 'b.sock');
  const helper = helperSession({ ECHO_BRIDGE_SOCKET: socket, ECHO_HELPER_HOME: dir });
  helper.send({ id: 1, cmd: 'bridge' });
  const started = await helper.next(m => m.id === 1);
  assert.deepEqual(started.result, { ok: true, socket });
  assert.equal(fs.statSync(socket).mode & 0o777, 0o600);

  const claude = socketClient(socket);
  await claude.ready;
  claude.send({ callId: 'c1', tool: 'observe', args: { full: true } });
  const call = await helper.next(m => m.bridge === 'call');
  assert.equal(call.tool, 'observe');
  assert.deepEqual(call.args, { full: true });
  helper.send({ bridgeReply: call.callId, result: { content: [{ type: 'text', text: 'Example Domain' }] } });
  const answer = await claude.next(m => m.callId === 'c1');
  assert.equal(answer.result.content[0].text, 'Example Domain');

  claude.send({ callId: 'c2', tool: '../../etc', args: {} });
  assert.match((await claude.next(m => m.callId === 'c2')).error, /Unknown tool/);
  claude.end();
  await helper.close();
  assert.ok(!fs.existsSync(socket), 'the socket goes away with the helper');
});

test('echo-mcp: Claude lists ECHO\'s tools and calls them; with ECHO closed it says how to fix it', async () => {
  const dir = shortDir();
  const socket = path.join(dir, 'm.sock');
  const tools = [{ name: 'observe', description: 'Read the page', inputSchema: { type: 'object' } }];
  const server = net.createServer(sock => {
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', chunk => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const m = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        const result = m.tool === '__tools' ? tools : { content: [{ type: 'text', text: `ran ${m.tool}` }] };
        sock.write(`${JSON.stringify({ callId: m.callId, result })}\n`);
      }
    });
  });
  await new Promise(r => server.listen(socket, r));
  const talk = async (socketPath, messages) => new Promise(resolve => {
    const child = spawn(process.execPath, [MCP], { env: { ...process.env, ECHO_BRIDGE_SOCKET: socketPath } });
    let out = '';
    child.stdout.on('data', c => { out += c; if (out.split('\n').filter(Boolean).length >= messages.length) child.kill(); });
    child.on('exit', () => resolve(Object.fromEntries(out.split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]))));
    for (const m of messages) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  });
  const r = await talk(socket, [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'observe', arguments: {} } }]);
  assert.equal(r[1].result.serverInfo.name, 'echo');
  assert.match(r[1].result.instructions, /shared with Claude/);
  assert.deepEqual(r[2].result.tools.map(t => t.name), ['observe']);
  assert.equal(r[3].result.content[0].text, 'ran observe');
  server.close();

  const closed = await talk(path.join(dir, 'missing.sock'), [{ id: 4, method: 'tools/call', params: { name: 'observe', arguments: {} } }]);
  assert.equal(closed[4].result.isError, true);
  assert.match(closed[4].result.content[0].text, /Let Claude use ECHO/);
});

test('add to Claude: Desktop\'s settings keep what was there (with a backup); Code gets "claude mcp add"', async () => {
  const dir = shortDir();
  fs.writeFileSync(path.join(dir, 'echo-mcp'), '#!/bin/bash\n', { mode: 0o755 });
  const desktop = path.join(dir, 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(desktop));
  fs.writeFileSync(desktop, JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
  const log = path.join(dir, 'claude.log');
  const cli = path.join(dir, 'fake-claude-cli');
  fs.writeFileSync(cli, `#!/bin/bash\necho "$*" >> "${log}"\n`, { mode: 0o755 });
  const helper = helperSession({ ECHO_HELPER_HOME: dir, ECHO_CLAUDE_DESKTOP_CONFIG: desktop, CLAUDE_CLI: cli });
  helper.send({ id: 1, cmd: 'add-to-claude', client: 'desktop' });
  helper.send({ id: 2, cmd: 'add-to-claude', client: 'code' });
  const [d, c] = [await helper.next(m => m.id === 1), await helper.next(m => m.id === 2)];
  await helper.close();
  assert.equal(d.result.ok, true, JSON.stringify(d));
  const config = JSON.parse(fs.readFileSync(desktop, 'utf8'));
  assert.deepEqual(config.mcpServers, { other: { command: 'x' }, echo: { command: path.join(dir, 'echo-mcp') } });
  assert.equal(config.theme, 'dark');
  assert.ok(fs.existsSync(`${desktop}.echo-backup`));
  assert.equal(c.result.ok, true, JSON.stringify(c));
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`mcp add --scope user echo -- ${path.join(dir, 'echo-mcp').replace(/[/.]/g, '\\$&')}`));
});

test('add to Claude Code without the "claude" command: its settings file gets ECHO, everything else kept, with a backup', async () => {
  const dir = shortDir();
  fs.writeFileSync(path.join(dir, 'echo-mcp'), '#!/bin/bash\n', { mode: 0o755 });
  const settings = path.join(dir, 'claude.json');
  fs.writeFileSync(settings, JSON.stringify({ numStartups: 12, projects: { '/x': { allowedTools: [] } }, mcpServers: { other: { type: 'stdio', command: 'y' } } }));
  const helper = helperSession({ ECHO_HELPER_HOME: dir, ECHO_CLAUDE_CODE_CONFIG: settings, CLAUDE_CLI: '', PATH: '/usr/bin:/bin' });
  helper.send({ id: 1, cmd: 'add-to-claude', client: 'code' });
  const r = await helper.next(m => m.id === 1);
  await helper.close();
  assert.equal(r.result.ok, true, JSON.stringify(r));
  const config = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(config.numStartups, 12);
  assert.deepEqual(config.projects, { '/x': { allowedTools: [] } });
  assert.deepEqual(config.mcpServers, { other: { type: 'stdio', command: 'y' }, echo: { type: 'stdio', command: path.join(dir, 'echo-mcp'), args: [], env: {} } });
  assert.ok(fs.existsSync(`${settings}.echo-backup`));
});
