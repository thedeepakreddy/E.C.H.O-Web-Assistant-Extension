// Echo Helper: lets ECHO turn agent mode on and off on this computer, so the
// user presses a button instead of typing commands. Chrome starts it (native
// messaging) only for ECHO's extension id. It runs a fixed set of OpenClaw
// commands with checked arguments: never a shell, never a command it was sent.
// Whatever it is asked, it keeps ECHO's agents locked down (no shell, no files,
// no OpenClaw browser) and ECHO's gateway on this computer only.

import { execFile } from 'node:child_process';
import { promises as fs, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_VERSION = 1;
const PROFILE = 'echo';
const PORT = 18790;
const HOME = os.homedir();
const STATE_DIR = path.join(HOME, `.openclaw-${PROFILE}`);
const DENIED = ['exec', 'process', 'write', 'edit', 'apply_patch', 'browser', 'nodes', 'cron', 'canvas'];
const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'];
const UNUSED_FILES = ['BOOTSTRAP.md', 'USER.md', 'HEARTBEAT.md'];
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

/** OpenClaw's agent settings, built here so they are always locked down. */
export function agentEntries(agents) {
  return Object.fromEntries(agents.map(a => [a.agentId, {
    identity: { name: 'Echo' },
    skills: [],
    tools: { allow: a.allow, deny: DENIED, exec: { security: 'deny' }, codeMode: false },
  }]));
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
  await must(oc, ['config', 'set', 'agents.entries', JSON.stringify(agentEntries(s.agents)), '--strict-json', '--merge'], 'Setting up the agents');
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
      track(handle(message, origin));
    }
  });
  process.stdin.on('end', () => { ended = true; exitWhenIdle(); });
}

// Started as a program (not imported by tests). Compare real paths: the helper's
// folder can be reached through a symlink (macOS /var is /private/var).
const realPath = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1])) main();
