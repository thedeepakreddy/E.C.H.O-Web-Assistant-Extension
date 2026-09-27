// ECHO for Claude Desktop and Claude Code: ECHO's MCP server. Claude starts a
// small program (echo-mcp, installed with Echo Helper) that reaches ECHO
// through the helper, and uses ECHO's browser tools in the one tab the user
// shared with it: the same tools, tab limits, page-reading rules and "Allow?"
// prompts (paying, sending) as ECHO's own agents. Off until the user turns it on.

import { HELPER_HOST } from './openclaw/helper-install';
import { browserToolsFor } from './openclaw/browser-tools';
import { toToolResult, type NodeTool, type ToolResult } from './openclaw/node-tools';
import { CLAUDE, leaseFor } from './agents/leases';
import { logAction } from './safety';

const SETTINGS_KEY = 'echo_claude_bridge';
// Claude's seat, shaped like an agent so the browser tools serve it unchanged.
const SEAT = { character: CLAUDE, slug: 'claude', agentId: CLAUDE, tagline: 'Claude' };
// A watcher wakes an agent in ECHO's chat when it fires; Claude can't be woken, so it is left out.
const LEFT_OUT = new Set(['watch']);
// Claude's MCP client usually waits about a minute for a tool.
const CALL_BUDGET_MS = 55_000;
const RETRY_MS = 30_000;

export interface ClaudeBridgeStatus {
  enabled: boolean;
  /** Echo Helper is running the bridge: Claude can reach ECHO. */
  connected: boolean;
  /** The tab Claude may use, if the user shared one. */
  tab: { id: number; title: string } | null;
  error?: string;
}

let port: chrome.runtime.Port | null = null;
let connected = false;
let lastError = '';
let retry: ReturnType<typeof setTimeout> | null = null;

const seatTools = (): NodeTool[] => browserToolsFor(SEAT).filter(t => !LEFT_OUT.has(t.name.replace(/^claude_/, '')));

/** The tools as Claude sees them: observe, act, navigate… */
export function claudeToolList(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return seatTools().map(t => ({ name: t.name.replace(/^claude_/, ''), description: t.description, inputSchema: t.parameters }));
}

const text = (message: string, isError = true): ToolResult & { isError?: boolean } => ({ content: [{ type: 'text', text: message }], ...(isError ? { isError } : {}) });

/** Run one of Claude's tool calls in its shared tab. */
export async function runClaudeTool(name: string, args: unknown): Promise<ToolResult & { isError?: boolean }> {
  const tool = seatTools().find(t => t.name === `claude_${name}`);
  if (!tool) return text(`There is no tool called ${String(name).slice(0, 60)}.`);
  if (!leaseFor(CLAUDE)) {
    return text('No tab is shared with Claude yet. In Chrome, open the page you want, then in ECHO\'s chat panel choose Assign Agent → Claude → Share this tab.');
  }
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const result = await tool.run(input, { deadline: Date.now() + CALL_BUDGET_MS });
  // Claude's calls are the user's history too.
  if (!['observe', 'read', 'find', 'extract', 'verify', 'transcript', 'screenshot'].includes(name)) {
    logAction(`claude_${name}`, `Claude used ${name}`, 'done').catch(() => {});
  }
  return toToolResult(result);
}

async function enabled(): Promise<boolean> {
  return ((await chrome.storage.local.get([SETTINGS_KEY]))[SETTINGS_KEY] as { enabled?: boolean } | undefined)?.enabled === true;
}

function disconnect() {
  if (retry) { clearTimeout(retry); retry = null; }
  const p = port;
  port = null;
  connected = false;
  try { p?.disconnect(); } catch { /* already gone */ }
}

function connect() {
  if (port) return;
  lastError = '';
  const p = chrome.runtime.connectNative(HELPER_HOST);
  port = p;
  p.onMessage.addListener((m: any) => {
    if (m?.id === 1) {
      connected = !m.error;
      lastError = m.error ? String(m.error) : '';
      if (m.error) disconnect();
      return;
    }
    if (m?.bridge === 'call' && typeof m.callId === 'string') {
      const reply = (payload: Record<string, unknown>) => { try { p.postMessage({ bridgeReply: m.callId, ...payload }); } catch { /* port closed */ } };
      if (m.tool === '__tools') { reply({ result: claudeToolList() }); return; }
      runClaudeTool(String(m.tool || ''), m.args)
        .then(result => reply({ result }))
        .catch(error => reply({ result: text(`Not done: ${error?.message || error}`) }));
    }
  });
  p.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message || '';
    if (port !== p) return;
    port = null;
    connected = false;
    lastError = /not found|forbidden|Specified native messaging host/i.test(why) ? 'Echo Helper is not installed. Turn agent mode on once to install it.'
      : why || lastError || 'Echo Helper stopped.';
    // Keep trying while the user wants Claude to reach ECHO.
    enabled().then(on => { if (on && !retry) retry = setTimeout(() => { retry = null; syncClaudeBridge(); }, RETRY_MS); }).catch(() => {});
  });
  p.postMessage({ id: 1, cmd: 'bridge' });
}

/** Connect or disconnect to match the setting. */
export async function syncClaudeBridge(): Promise<void> {
  if (await enabled()) connect(); else disconnect();
}

export async function setClaudeBridge(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { enabled: on } });
  await syncClaudeBridge();
}

export async function claudeBridgeStatus(): Promise<ClaudeBridgeStatus> {
  const lease = leaseFor(CLAUDE);
  let tab: ClaudeBridgeStatus['tab'] = null;
  if (lease) {
    const t = await chrome.tabs.get(lease.tabId).catch(() => null);
    tab = { id: lease.tabId, title: t?.title || t?.url || 'a tab' };
  }
  return { enabled: await enabled(), connected, tab, ...(lastError ? { error: lastError } : {}) };
}

export function startClaudeBridge(): void {
  syncClaudeBridge().catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SETTINGS_KEY in changes) syncClaudeBridge().catch(() => {});
  });
}
