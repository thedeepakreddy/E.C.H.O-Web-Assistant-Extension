#!/usr/bin/env node
// Echo GitHub: the GitHub app ECHO's agents use through OpenClaw. A small MCP
// server on stdio that passes requests to GitHub's official remote MCP server,
// signed in as the user: with the GitHub CLI's login (`gh auth token`) or a
// token saved by Echo Helper in a file only the user can read. Agents get
// reading, issues and comments; nothing that pushes, merges or deletes.
// Posting (an issue, a comment) is paused by Echo guard until the user allows it.
//
//   node echo-github.mjs            serve MCP on stdin/stdout
//   node echo-github.mjs --check    sign in once: {"ok":true,"login":...} or {"ok":false,"error":...}

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = process.env.ECHO_GITHUB_CONFIG || path.join(os.homedir(), '.openclaw-echo', 'echo-helper', 'apps', 'github.json');
const REMOTE = process.env.ECHO_GITHUB_MCP_URL || 'https://api.githubcopilot.com/mcp/';
const API = process.env.ECHO_GITHUB_API_URL || 'https://api.github.com';
const TOOLSETS = 'context,repos,issues,pull_requests,users';

// What agents may do: read, and talk in issues. Everything else is left out.
const WRITE_ALLOWED = new Set(['create_issue', 'add_issue_comment', 'update_issue', 'issue_write', 'add_comment_to_pending_review']);
export function allowedTool(name) {
  const n = String(name || '');
  return /^(get|list|search)_/.test(n) || n === 'issue_read' || n === 'pull_request_read' || WRITE_ALLOWED.has(n);
}

const findGh = () => ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', ...String(process.env.PATH || '').split(':').map(d => path.join(d, 'gh'))]
  .find(p => existsSync(p)) || null;

/** The user's GitHub token: from the GitHub CLI's login, or the one they saved. Never logged. */
export async function token(file = CONFIG_FILE) {
  const c = JSON.parse(readFileSync(file, 'utf8'));
  if (c.source === 'gh') {
    const gh = findGh();
    if (!gh) throw new Error('The GitHub CLI is not installed any more. Connect GitHub again in ECHO\'s settings.');
    return new Promise((resolve, reject) => execFile(gh, ['auth', 'token'], { timeout: 15_000 }, (error, stdout) => {
      const t = String(stdout || '').trim();
      if (error || !t) reject(new Error('The GitHub CLI is signed out. Run "gh auth login", or connect GitHub again in ECHO\'s settings.'));
      else resolve(t);
    }));
  }
  if (typeof c.token === 'string' && /^[A-Za-z0-9_]{20,255}$/.test(c.token)) return c.token;
  throw new Error('GitHub is not set up. Connect it again in ECHO\'s settings.');
}

/** A client for GitHub's remote MCP server (Streamable HTTP). */
export function createRemote({ getToken, fetchImpl = fetch, url = REMOTE }) {
  let session = null;
  async function post(message) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        authorization: `Bearer ${await getToken()}`, 'x-mcp-toolsets': TOOLSETS,
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify(message),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session = sid;
    if (res.status === 401 || res.status === 403) throw new Error('GitHub refused the sign-in. Connect GitHub again in ECHO\'s settings.');
    if (res.status === 202 || message.id === undefined) return null;
    if (!res.ok) throw new Error(`GitHub's MCP server answered ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    if (type.includes('text/event-stream')) {
      // The answer is the event carrying this request's id.
      for (const block of body.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === message.id) return m; } catch { /* keep looking */ }
      }
      throw new Error('GitHub\'s MCP server sent no answer.');
    }
    return JSON.parse(body);
  }
  return {
    post,
    reset() { session = null; },
  };
}

/** The bridge: this side answers OpenClaw; tools/list and tools/call go to GitHub, filtered. */
export function createBridge(remote) {
  let initialized = false;
  async function ensureSession() {
    if (initialized) return;
    const init = await remote.post({ jsonrpc: '2.0', id: 'echo-init', method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'echo-github', version: '1.0.0' } } });
    if (init?.error) throw new Error(init.error.message || 'GitHub\'s MCP server did not start a session.');
    await remote.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    initialized = true;
  }
  return {
    async handle(msg) {
      if (msg.method === 'initialize') {
        return { result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo-github', version: '1.0.0' } } };
      }
      if (msg.method === 'ping') return { result: {} };
      if (msg.method === 'tools/list') {
        await ensureSession();
        const r = await remote.post({ jsonrpc: '2.0', id: msg.id, method: 'tools/list', params: msg.params || {} });
        if (r?.error) return { error: r.error };
        return { result: { ...r.result, tools: (r.result?.tools || []).filter(t => allowedTool(t.name)) } };
      }
      if (msg.method === 'tools/call') {
        const name = msg.params?.name;
        if (!allowedTool(name)) return { result: { content: [{ type: 'text', text: `${name} is not available to ECHO's agents.` }], isError: true } };
        await ensureSession();
        const r = await remote.post({ jsonrpc: '2.0', id: msg.id, method: 'tools/call', params: msg.params });
        return r?.error ? { error: r.error } : { result: r?.result };
      }
      return { error: { code: -32601, message: `Method not found: ${msg.method}` } };
    },
  };
}

/** Sign in once: who the token belongs to. */
export async function check({ getToken = () => token(), fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/user`, { headers: { authorization: `Bearer ${await getToken()}`, accept: 'application/vnd.github+json', 'user-agent': 'echo-github' } });
  if (!res.ok) return { ok: false, error: res.status === 401 ? 'GitHub refused the token.' : `GitHub answered ${res.status}.` };
  const user = await res.json();
  return { ok: true, login: String(user.login || '') };
}

function serve() {
  const bridge = createBridge(createRemote({ getToken: () => token() }));
  const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  createInterface({ input: process.stdin }).on('line', async line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;
    try {
      out({ jsonrpc: '2.0', id: msg.id, ...(await bridge.handle(msg)) });
    } catch (error) {
      out({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(error?.message || 'GitHub did not answer.').slice(0, 300) }], isError: true } });
    }
  });
}

const realPath = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1])) {
  if (process.argv.includes('--check')) {
    check().then(r => { console.log(JSON.stringify(r)); if (!r.ok) process.exitCode = 1; },
      error => { console.log(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 200) })); process.exitCode = 1; });
  } else {
    serve();
  }
}
