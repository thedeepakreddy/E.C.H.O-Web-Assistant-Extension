// Echo Helper: lets ECHO turn agent mode on and off on this computer, so the
// user presses a button instead of typing commands. Chrome starts it (native
// messaging) only for ECHO's extension id. It runs a fixed set of OpenClaw
// commands with checked arguments: never a shell, never a command it was sent.
// Whatever it is asked, it keeps ECHO's agents locked down (no shell, no files,
// no OpenClaw browser) and ECHO's gateway on this computer only.

import { execFile } from 'node:child_process';
import { promises as fs, existsSync, realpathSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_VERSION = 3;
const PROFILE = 'echo';
const PORT = 18790;
const HOME = os.homedir();
const STATE_DIR = path.join(HOME, `.openclaw-${PROFILE}`);
const DENIED = ['exec', 'process', 'write', 'edit', 'apply_patch', 'browser', 'nodes', 'cron', 'canvas'];
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'];
const UNUSED_FILES = ['BOOTSTRAP.md', 'USER.md', 'HEARTBEAT.md'];
// Where the helper, Echo guard and the apps live (next to this file once installed).
const HELPER_DIR = process.env.ECHO_HELPER_HOME || path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.join(HELPER_DIR, 'apps');
const GUARD_DIR = path.join(HELPER_DIR, 'echo-guard');
// Where echo-mcp (started by Claude) reaches ECHO. Unix socket paths are short.
export const BRIDGE_SOCKET = process.env.ECHO_BRIDGE_SOCKET || (() => {
  const p = path.join(HELPER_DIR, 'echo.sock');
  return p.length < 100 ? p : path.join('/tmp', `echo-${process.getuid?.() ?? 'user'}.sock`);
})();
const AI = {
  google: { model: 'google/gemini-3.8-flash', fallbacks: ['google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash'] },
  anthropic: { model: 'anthropic/claude-sonnet-5', fallbacks: [] },
};

// --- checks ------------------------------------------------------------------

const AGENT_ID = /^echo(-[a-z]+)?$/;
const TOOL_NAME = /^[a-z]+_[a-z]+$/;
const COMMAND = /^echo\.[a-z]+\.[a-z]+$/;
const HEX = /^[0-9a-f]{16,128}$/i;
const ORIGIN = /^chrome-extension:\/\/[a-p]{32}\/?$/;

function check(condition, message) { if (!condition) throw new Error(message); }

/** The setup ECHO asks for, as checked data (anything else is refused). */
export function checkSetup(req) {
  const setup = req?.setup || {};
  check(HEX.test(String(req?.token || '')), 'Bad token.');
  check(HEX.test(String(req?.deviceId || '')), 'Bad device id.');
  const commands = Array.isArray(setup.commands) ? setup.commands : [];
  check(commands.length > 0 && commands.length <= 256 && commands.every(c => COMMAND.test(c)), 'Bad command list.');
  const agents = Array.isArray(setup.agents) ? setup.agents : [];
  check(agents.length > 0 && agents.length <= 16, 'Bad agent list.');
  for (const a of agents) {
    check(AGENT_ID.test(String(a?.agentId)), 'Bad agent id.');
    check(Array.isArray(a.allow) && a.allow.length <= 32 && a.allow.every(t => TOOL_NAME.test(t)), 'Bad tool list.');
    for (const name of Object.keys(a.files || {})) check(WORKSPACE_FILES.includes(name), 'Bad workspace file.');
    for (const text of Object.values(a.files || {})) check(typeof text === 'string' && text.length < 20_000, 'Bad workspace file.');
  }
  if (req.ai) {
    check(Object.keys(AI).includes(req.ai.provider), 'Unknown AI provider.');
    check(typeof req.ai.key === 'string' && req.ai.key.trim().length >= 8 && req.ai.key.length < 500 && !/\s/.test(req.ai.key.trim()), 'That API key does not look right.');
  }
  return { token: req.token, deviceId: req.deviceId.toLowerCase(), commands, agents, ai: req.ai };
}

/** OpenClaw's agent settings, built here so they are always locked down. `grants` adds the apps each agent may use. */
export function agentEntries(agents, grants = {}) {
  return Object.fromEntries(agents.map(a => [a.agentId, {
    identity: { name: 'Echo' },
    skills: [],
    tools: { allow: [...a.allow, ...(grants[a.agentId] || [])], deny: DENIED, exec: { security: 'deny' }, codeMode: false },
  }]));
}

// --- apps agents can use (MCP servers ECHO ships) ------------------------------------

export const APPS = {
  mail: { server: 'echo-mail', program: 'echo-mail.mjs', file: 'mail.json', env: 'ECHO_MAIL_CONFIG' },
  github: { server: 'echo-github', program: 'echo-github.mjs', file: 'github.json', env: 'ECHO_GITHUB_CONFIG' },
};
export const MAIL_PROVIDERS = {
  gmail: { imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  icloud: { imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
  yahoo: { imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
};
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const GITHUB_TOKEN = /^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,250}$/;

const appsState = async () => { try { return JSON.parse(await fs.readFile(path.join(APPS_DIR, 'state.json'), 'utf8')); } catch { return {}; } };
async function saveAppsState(state) {
  await fs.mkdir(APPS_DIR, { recursive: true, mode: 0o700 });
  await writePrivate(path.join(APPS_DIR, 'state.json'), JSON.stringify(state, null, 2));
}
/** A file only this user can read, replaced in one step. */
async function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Which app tools each agent may use: "echo-mail__*" for every agent the user picked. */
export function appGrants(state) {
  const grants = {};
  for (const [app, info] of Object.entries(state || {})) {
    if (!APPS[app]) continue;
    for (const agentId of info?.agents || []) if (AGENT_ID.test(agentId)) (grants[agentId] ||= []).push(`${APPS[app].server}__*`);
  }
  return grants;
}

/** Give each ECHO agent exactly its apps, keeping its browser tools. */
async function applyGrants(oc, state) {
  const entries = await runJson(oc, ['config', 'get', 'agents.entries']) || {};
  const grants = appGrants(state);
  for (const [agentId, entry] of Object.entries(entries)) {
    if (!AGENT_ID.test(agentId) || !Array.isArray(entry?.tools?.allow)) continue;
    const allow = [...entry.tools.allow.filter(t => !String(t).includes('__')), ...(grants[agentId] || [])];
    await must(oc, ['config', 'set', `agents.entries.${agentId}.tools.allow`, JSON.stringify(allow), '--strict-json'], 'Giving the agents the app');
  }
}

async function enableGuard(oc) {
  check(existsSync(path.join(GUARD_DIR, 'index.mjs')), 'Echo Helper is out of date. Install it again from ECHO\'s settings.');
  await must(oc, ['config', 'set', 'plugins.load.paths', JSON.stringify([GUARD_DIR]), '--strict-json'], 'Turning on approvals');
  await must(oc, ['config', 'set', 'plugins.entries.echo-guard', JSON.stringify({ enabled: true }), '--strict-json'], 'Turning on approvals');
}

const echoAgents = async oc => Object.keys(await runJson(oc, ['config', 'get', 'agents.entries']) || {}).filter(id => AGENT_ID.test(id));
function checkAgents(list, known) {
  check(Array.isArray(list) && list.length <= 16 && list.every(a => AGENT_ID.test(String(a))), 'Bad agent list.');
  return list.filter(a => known.includes(a));
}

/** What is connected, without any secret. */
export async function apps() {
  const state = await appsState();
  const available = {
    mail: existsSync(path.join(HELPER_DIR, APPS.mail.program)) && existsSync(path.join(HELPER_DIR, 'node_modules', 'imapflow')),
    github: existsSync(path.join(HELPER_DIR, APPS.github.program)),
  };
  const out = {};
  for (const app of Object.keys(APPS)) {
    const info = state[app];
    out[app] = { available: available[app], connected: !!info && existsSync(path.join(APPS_DIR, APPS[app].file)),
      ...(info ? { account: info.account || '', agents: info.agents || [] } : {}) };
  }
  return out;
}

/** Run an app's own sign-in check with the credentials just saved. */
function checkApp(app, credFile) {
  return new Promise(resolve => execFile(process.execPath, [path.join(HELPER_DIR, APPS[app].program), '--check'],
    { timeout: 45_000, env: { ...process.env, [APPS[app].env]: credFile } }, (error, stdout) => {
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch { resolve({ ok: false, error: error?.killed ? 'The sign-in took too long.' : 'The app did not start.' }); }
    }));
}

/**
 * Connect an app for the agents: save the user's credentials where only they
 * can read them, sign in once to check, and add the app to OpenClaw. The
 * credentials never go into OpenClaw's settings, and are never echoed back.
 */
export async function connectApp(req, origin) {
  const oc = findOpenClaw();
  check(oc, 'OpenClaw is not installed.');
  check(ORIGIN.test(origin || ''), 'Unknown caller.');
  const app = String(req?.app || '');
  check(APPS[app], 'Unknown app.');
  check(existsSync(path.join(HELPER_DIR, APPS[app].program)), 'Echo Helper is out of date. Install it again from ECHO\'s settings.');
  const known = await echoAgents(oc);
  check(known.length, 'Turn agent mode on first.');
  const agents = req.agents === undefined ? known : checkAgents(req.agents, known);
  let cred;
  let account;
  if (app === 'mail') {
    const address = String(req.address || '').trim();
    check(EMAIL.test(address) && address.length <= 200, 'That email address does not look right.');
    const provider = String(req.provider || '');
    let servers = MAIL_PROVIDERS[provider];
    if (provider === 'custom') {
      const port = n => Number.isInteger(Number(n)) && Number(n) > 0 && Number(n) < 65536 ? Number(n) : 0;
      check(HOST.test(String(req.imapHost || '')) && HOST.test(String(req.smtpHost || '')), 'Check the mail server names.');
      servers = { imap: { host: req.imapHost, port: port(req.imapPort) || 993, secure: true },
        smtp: { host: req.smtpHost, port: port(req.smtpPort) || 465, secure: (port(req.smtpPort) || 465) === 465 } };
    }
    check(servers, 'Choose your email provider.');
    // App passwords are shown in groups ("abcd efgh ijkl mnop"); the spaces are not part of it.
    const password = String(req.password || '').replace(/\s+/g, '');
    check(password.length >= 8 && password.length <= 128, 'That app password does not look right.');
    cred = { address, password, provider, ...servers };
    account = address;
  } else {
    if (req.source === 'gh') cred = { source: 'gh' };
    else {
      const token = String(req.token || '').trim();
      check(GITHUB_TOKEN.test(token), 'That GitHub token does not look right.');
      cred = { token };
    }
  }
  await fs.mkdir(APPS_DIR, { recursive: true, mode: 0o700 });
  const credFile = path.join(APPS_DIR, APPS[app].file);
  await writePrivate(credFile, JSON.stringify(cred));
  const checked = await checkApp(app, credFile);
  if (!checked?.ok) {
    await fs.rm(credFile, { force: true });
    throw new Error(checked?.error || 'Could not sign in.');
  }
  if (app === 'github') account = checked.login || 'GitHub';
  await enableGuard(oc);
  const server = { command: process.execPath, args: [path.join(HELPER_DIR, APPS[app].program)], env: { [APPS[app].env]: credFile } };
  await must(oc, ['config', 'set', `mcp.servers.${APPS[app].server}`, JSON.stringify(server), '--strict-json'], 'Adding the app');
  const state = await appsState();
  state[app] = { agents, account };
  await saveAppsState(state);
  await applyGrants(oc, state);
  return { ok: true, account, agents };
}

export async function disconnectApp(req) {
  const oc = findOpenClaw();
  check(oc, 'OpenClaw is not installed.');
  const app = String(req?.app || '');
  check(APPS[app], 'Unknown app.');
  await run(oc, ['config', 'unset', `mcp.servers.${APPS[app].server}`]);
  await fs.rm(path.join(APPS_DIR, APPS[app].file), { force: true });
  const state = await appsState();
  delete state[app];
  await saveAppsState(state);
  await applyGrants(oc, state);
  return { ok: true };
}

/** Choose which agents may use an app. */
export async function setAppAgents(req) {
  const oc = findOpenClaw();
  check(oc, 'OpenClaw is not installed.');
  const app = String(req?.app || '');
  check(APPS[app], 'Unknown app.');
  const state = await appsState();
  check(state[app], 'That app is not connected.');
  state[app].agents = checkAgents(req.agents, await echoAgents(oc));
  await saveAppsState(state);
  await applyGrants(oc, state);
  return { ok: true, agents: state[app].agents };
}

// --- running OpenClaw --------------------------------------------------------------

function findOpenClaw() {
  const candidates = [
    process.env.OPENCLAW,
    ...String(process.env.PATH || '').split(':').map(dir => path.join(dir, 'openclaw')),
    path.join(HOME, '.npm-global/bin/openclaw'),
    '/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw', path.join(HOME, '.local/bin/openclaw'),
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) || null;
}

function run(oc, args, { input, timeoutMs = 120_000 } = {}) {
  return new Promise(resolve => {
    const child = execFile(oc, ['--profile', PROFILE, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: `${path.dirname(oc)}:${path.dirname(process.execPath)}:${process.env.PATH || '/usr/bin:/bin'}` } },
    (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    if (input !== undefined) { child.stdin.end(input); } else child.stdin.end();
  });
}

async function runJson(oc, args) {
  const r = await run(oc, [...args, '--json']);
  try { return JSON.parse(r.stdout.slice(r.stdout.search(/[[{]/))); } catch { return null; }
}

async function must(oc, args, what, opts) {
  const r = await run(oc, args, opts);
  if (!r.ok) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim().split('\n').pop() || 'no details'}`);
  return r;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- what ECHO can ask --------------------------------------------------------------

export async function hello() {
  const oc = findOpenClaw();
  if (!oc) return { helper: HELPER_VERSION, openclaw: null };
  const version = (await run(oc, ['--version'])).stdout.match(/\d{4}\.\d+\.\d+/)?.[0] || '';
  const status = await runJson(oc, ['models', 'status']);
  const configured = (status?.auth?.providers || []).some(p => (p.profiles?.count || 0) > 0);
  const running = (await run(oc, ['health'], { timeoutMs: 15_000 })).ok;
  return { helper: HELPER_VERSION, openclaw: { version }, running, model: configured ? (status?.defaultModel || 'set') : null };
}

/**
 * Agent mode on: configure ECHO's profile for this ECHO, set the AI if asked,
 * run the gateway as a background service, and approve this ECHO once it
 * connects. `progress` reports each step.
 */
export async function turnOn(req, origin, progress) {
  const oc = findOpenClaw();
  check(oc, 'OpenClaw is not installed.');
  check(ORIGIN.test(origin || ''), 'Unknown caller.');
  const s = checkSetup(req);
  const extensionOrigin = origin.replace(/\/$/, '');

  progress('Setting up your agents');
  const sets = [
    ['gateway.mode', 'local'], ['gateway.port', String(PORT), true], ['gateway.bind', 'loopback'], ['gateway.auth.mode', 'token'],
    ['gateway.controlUi.allowedOrigins', JSON.stringify([extensionOrigin]), true], ['discovery.mdns.mode', 'off'],
    ['agents.defaults.heartbeat.every', '0m'], ['tools.agentToAgent.enabled', 'false', true], ['tools.codeMode', 'false', true],
    ['tools.toolSearch', 'false', true], ['agents.defaults.skipOptionalBootstrapFiles', JSON.stringify(['USER.md']), true],
    ['gateway.nodes.commands.allow', JSON.stringify(s.commands), true],
  ];
  for (const [key, value, strict] of sets) await must(oc, ['config', 'set', key, value, ...(strict ? ['--strict-json'] : [])], `Setting ${key}`);
  await must(oc, ['config', 'set', 'agents.entries', JSON.stringify(agentEntries(s.agents, appGrants(await appsState()))), '--strict-json', '--merge'], 'Setting up the agents');
  // Echo guard asks in ECHO before an agent sends or pays through an app.
  if (existsSync(path.join(GUARD_DIR, 'index.mjs'))) await enableGuard(oc);
  await must(oc, ['config', 'set', 'gateway.auth.token', s.token], 'Setting the connection key');
  for (const a of s.agents) {
    const dir = path.join(STATE_DIR, `workspace-${a.agentId}`);
    await fs.mkdir(dir, { recursive: true });
    for (const name of UNUSED_FILES) await fs.rm(path.join(dir, name), { force: true });
    for (const [name, text] of Object.entries(a.files || {})) await fs.writeFile(path.join(dir, name), text);
  }
  await must(oc, ['config', 'validate'], 'Checking the settings');

  if (s.ai) {
    progress('Saving your AI key');
    const ai = AI[s.ai.provider];
    await must(oc, ['models', 'auth', 'paste-api-key', '--provider', s.ai.provider], 'Saving the AI key', { input: `${s.ai.key.trim()}\n` });
    await must(oc, ['models', 'set', ai.model], 'Choosing the model');
    for (const f of ai.fallbacks) await run(oc, ['models', 'fallbacks', 'add', f]);
  } else {
    const status = await runJson(oc, ['models', 'status']);
    check((status?.auth?.providers || []).some(p => (p.profiles?.count || 0) > 0), 'NEEDS_AI_KEY');
  }

  progress('Starting OpenClaw');
  await run(oc, ['daemon', 'stop', '--force']);
  await run(oc, ['doctor', '--fix', '--non-interactive'], { timeoutMs: 180_000 });
  await must(oc, ['daemon', 'install', '--force'], 'Starting OpenClaw');
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { up = (await run(oc, ['health'], { timeoutMs: 10_000 })).ok; if (!up) await sleep(1000); }
  check(up, 'OpenClaw did not start.');
  progress('Connecting ECHO', { started: true });

  for (let i = 0; i < 60; i++) {
    const devices = await runJson(oc, ['devices', 'list']);
    for (const r of devices?.pending || []) if (String(r.deviceId).toLowerCase() === s.deviceId) await run(oc, ['devices', 'approve', r.requestId]);
    const nodes = await runJson(oc, ['nodes', 'pending']);
    for (const r of nodes?.pending || (Array.isArray(nodes) ? nodes : [])) {
      if (String(r.nodeId || r.deviceId).toLowerCase() === s.deviceId) await run(oc, ['nodes', 'approve', r.requestId || r.id]);
    }
    const node = await runJson(oc, ['nodes', 'describe', '--node', s.deviceId]);
    if (node?.connected && node.approvalState === 'approved') return { ok: true };
    await sleep(2000);
  }
  throw new Error('ECHO did not connect. Keep its side panel open and press Turn on again.');
}

// --- ECHO for Claude Desktop and Claude Code -----------------------------------------

let bridge = null;
const BRIDGE_TOOL = /^(__tools|[a-z][a-z_]{0,39})$/;

/**
 * While ECHO keeps this helper open, Claude's echo-mcp can reach it through a
 * socket only this user can open. Each call goes to ECHO; its answer comes back.
 */
export async function startBridge(send) {
  if (bridge) return { ok: true, socket: BRIDGE_SOCKET };
  if (existsSync(BRIDGE_SOCKET)) {
    const alive = await new Promise(resolve => {
      const c = net.createConnection(BRIDGE_SOCKET);
      c.on('connect', () => { c.destroy(); resolve(true); });
      c.on('error', () => resolve(false));
    });
    check(!alive, 'Another browser already shares ECHO with Claude. Turn it off there first.');
    await fs.rm(BRIDGE_SOCKET, { force: true });
  }
  const pending = new Map();
  const server = net.createServer(sock => {
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { sock.destroy(); return; }
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const tool = String(m?.tool || '');
        if (!BRIDGE_TOOL.test(tool)) { sock.write(`${JSON.stringify({ callId: m?.callId, error: 'Unknown tool.' })}\n`); continue; }
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        pending.set(id, { sock, callId: m.callId });
        send({ bridge: 'call', callId: id, tool, args: m.args && typeof m.args === 'object' ? m.args : {} });
      }
    });
    sock.on('close', () => { for (const [id, p] of pending) if (p.sock === sock) pending.delete(id); });
    sock.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(BRIDGE_SOCKET, resolve); });
  await fs.chmod(BRIDGE_SOCKET, 0o600);
  bridge = { server, pending };
  process.on('exit', () => { try { unlinkSync(BRIDGE_SOCKET); } catch { /* gone */ } });
  return { ok: true, socket: BRIDGE_SOCKET };
}

/** ECHO's answer to one of Claude's calls. */
export function bridgeReply(m) {
  const p = bridge?.pending.get(m.bridgeReply);
  if (!p) return;
  bridge.pending.delete(m.bridgeReply);
  p.sock.write(`${JSON.stringify({ callId: p.callId, ...(m.error ? { error: String(m.error) } : { result: m.result }) })}\n`);
}

const CLAUDE_DESKTOP_CONFIG = process.env.ECHO_CLAUDE_DESKTOP_CONFIG || (process.platform === 'darwin'
  ? path.join(HOME, 'Library/Application Support/Claude/claude_desktop_config.json')
  : path.join(HOME, '.config/Claude/claude_desktop_config.json'));
const ECHO_MCP = path.join(HELPER_DIR, 'echo-mcp');
// Claude Code's user settings (where "claude mcp add --scope user" writes).
const CLAUDE_CODE_CONFIG = process.env.ECHO_CLAUDE_CODE_CONFIG || path.join(HOME, '.claude.json');

function findClaudeCli() {
  const candidates = [process.env.CLAUDE_CLI, ...String(process.env.PATH || '').split(':').map(dir => path.join(dir, 'claude')),
    path.join(HOME, '.local/bin/claude'), path.join(HOME, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(Boolean);
  return candidates.find(p => existsSync(p)) || null;
}
const runPlain = (cmd, args) => new Promise(resolve => execFile(cmd, args, { timeout: 60_000 },
  (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout || '') + String(stderr || '') })));

/** Add ECHO's MCP server to Claude Code (user settings) or Claude Desktop (its config file, backed up first). */
export async function addToClaude(req) {
  check(existsSync(ECHO_MCP), 'Echo Helper is out of date. Install it again from ECHO\'s settings.');
  if (req?.client === 'desktop') {
    const file = CLAUDE_DESKTOP_CONFIG;
    check(existsSync(path.dirname(file)), 'Claude Desktop is not installed on this computer.');
    let config = {};
    if (existsSync(file)) {
      const raw = await fs.readFile(file, 'utf8');
      try { config = raw.trim() ? JSON.parse(raw) : {}; } catch { throw new Error('Claude Desktop\'s settings file could not be read, so it was left as it is.'); }
      check(config && typeof config === 'object' && !Array.isArray(config), 'Claude Desktop\'s settings file could not be read, so it was left as it is.');
      await fs.writeFile(`${file}.echo-backup`, raw, { mode: 0o600 });
    }
    config.mcpServers = { ...(config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}), echo: { command: ECHO_MCP } };
    await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    return { ok: true, restart: true, path: file };
  }
  if (req?.client === 'code') {
    const cli = findClaudeCli();
    if (cli) {
      await runPlain(cli, ['mcp', 'remove', 'echo', '--scope', 'user']);
      const r = await runPlain(cli, ['mcp', 'add', '--scope', 'user', 'echo', '--', ECHO_MCP]);
      check(r.ok, `Claude Code did not add ECHO: ${r.out.trim().split('\n').pop() || 'no details'}`);
      return { ok: true };
    }
    // No "claude" command (the Claude app's Code tab has none): add ECHO to
    // Claude Code's user settings file directly, the way "claude mcp add
    // --scope user" does. Backed up first, and replaced in one step.
    const file = CLAUDE_CODE_CONFIG;
    check(existsSync(file), 'Claude Code is not set up on this computer yet. Open Claude Code once, then try again.');
    const raw = await fs.readFile(file, 'utf8');
    let config;
    try { config = JSON.parse(raw); } catch { throw new Error('Claude Code\'s settings file could not be read, so it was left as it is.'); }
    check(config && typeof config === 'object' && !Array.isArray(config), 'Claude Code\'s settings file could not be read, so it was left as it is.');
    await fs.writeFile(`${file}.echo-backup`, raw, { mode: 0o600 });
    config.mcpServers = { ...(config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}),
      echo: { type: 'stdio', command: ECHO_MCP, args: [], env: {} } };
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
    return { ok: true, path: file };
  }
  throw new Error('Unknown Claude app.');
}

/** Agent mode off: stop the gateway service and keep it from starting at login. */
export async function turnOff() {
  const oc = findOpenClaw();
  check(oc, 'OpenClaw is not installed.');
  await run(oc, ['daemon', 'stop', '--force', '--disable']);
  return { ok: true };
}

// --- native messaging: 4-byte little-endian length, then JSON ---------------------

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
}

async function handle(message, origin) {
  const id = message?.id;
  try {
    let result;
    if (message?.cmd === 'hello') result = await hello();
    else if (message?.cmd === 'turn-on') result = await turnOn(message, origin, (step, extra = {}) => send({ id, progress: step, ...extra }));
    else if (message?.cmd === 'turn-off') result = await turnOff();
    else if (message?.cmd === 'apps') result = await apps();
    else if (message?.cmd === 'bridge') { check(ORIGIN.test(origin || ''), 'Unknown caller.'); result = await startBridge(send); }
    else if (message?.cmd === 'add-to-claude') { check(ORIGIN.test(origin || ''), 'Unknown caller.'); result = await addToClaude(message); }
    else if (message?.cmd === 'connect-app') result = await connectApp(message, origin);
    else if (message?.cmd === 'disconnect-app') { check(ORIGIN.test(origin || ''), 'Unknown caller.'); result = await disconnectApp(message); }
    else if (message?.cmd === 'app-agents') { check(ORIGIN.test(origin || ''), 'Unknown caller.'); result = await setAppAgents(message); }
    else throw new Error('Unknown request.');
    send({ id, result });
  } catch (error) {
    send({ id, error: String(error?.message || error) });
  }
}

export function main() {
  // Chrome passes the calling extension's origin as the first argument.
  const origin = process.argv.find(a => a.startsWith('chrome-extension://')) || '';
  // Chrome closes the pipe when ECHO's page goes away; finish any work first,
  // so a setup is never left half done.
  let working = 0;
  let ended = false;
  const exitWhenIdle = () => { if (ended && working === 0) process.exit(0); };
  const track = work => { working++; work.finally(() => { working--; exitWhenIdle(); }); };
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 1024 * 1024) process.exit(1);
      if (buffer.length < 4 + length) break;
      let message = null;
      try { message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')); } catch { /* answered below */ }
      buffer = buffer.subarray(4 + length);
      // ECHO answering one of Claude's calls (the bridge), or a request.
      if (message && typeof message.bridgeReply === 'string') bridgeReply(message);
      else track(handle(message, origin));
    }
  });
  process.stdin.on('end', () => { ended = true; exitWhenIdle(); });
}

// Started as a program (not imported by tests). Compare real paths: the helper's
// folder can be reached through a symlink (macOS /var is /private/var).
const realPath = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1])) main();
