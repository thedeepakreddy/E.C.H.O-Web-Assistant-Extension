// Agent mode from a button. ECHO asks Echo Helper, a small program on this
// computer, to set up and run OpenClaw for it, and pairs with the gateway using
// a token it made itself: the user never opens a terminal after the helper's
// one-time install, never copies a token and never approves anything by hand.

import { HELPER_HOST, HELPER_VERSION, helperInstallCommand } from './helper-install';
import { AVATAR_AGENTS, TOOL_NAMES, allCommands, toolNameFor } from './registry';
import { agentsMd, soulMd, identityMd } from './setup-script';
import { prepareOpenClawPairing, reconnectOpenClaw, saveOpenClawSettings } from './index';
import { getAuthConfig } from '../auth';
import { claudeToolList } from '../claude-bridge';

export interface HelperInfo {
  helper: number;
  /** Installed before this ECHO's version of the helper: install it again. */
  outdated?: boolean;
  openclaw: { version: string } | null;
  running?: boolean;
  /** The model agents use, or null when no AI key is set up yet. */
  model?: string | null;
}

export type AiChoice = { provider: 'google' | 'anthropic'; key: string };

export type TurnOnResult =
  | { ok: true }
  | { needsHelper: true; command: string }
  | { needsAiKey: true }
  | { error: string };

/** Echo Helper's answer to a single request, or null when it is not installed. */
async function ask(message: Record<string, unknown>): Promise<any | null> {
  try {
    const reply: any = await chrome.runtime.sendNativeMessage(HELPER_HOST, { id: 1, ...message });
    if (reply?.error) throw new Error(reply.error);
    return reply?.result ?? null;
  } catch (error: any) {
    // Not installed (or not allowed for this ECHO): Chrome cannot start it.
    if (/native messaging host|not found|forbidden|Access to the specified/i.test(String(error?.message))) return null;
    throw error;
  }
}

export async function helperInfo(): Promise<HelperInfo | null> {
  const info: HelperInfo | null = await ask({ cmd: 'hello' });
  return info ? { ...info, outdated: (Number(info.helper) || 0) < HELPER_VERSION } : null;
}


// --- apps for agents -------------------------------------------------------------------

export type AppId = 'mail' | 'github';
export interface AppInfo { available: boolean; connected: boolean; account?: string; agents?: string[] }

export async function appsInfo(): Promise<Record<AppId, AppInfo> | null> {
  return ask({ cmd: 'apps' });
}

/** Connect an app. The password or token passes through to Echo Helper; ECHO does not keep it. */
export async function connectApp(req: Record<string, unknown>): Promise<{ account: string; agents: string[] }> {
  return ask({ ...req, cmd: 'connect-app' });
}
export async function disconnectApp(app: AppId): Promise<void> { await ask({ cmd: 'disconnect-app', app }); }

/** Add ECHO's MCP server to Claude Code (its user settings) or Claude Desktop (its config file). */
export async function addEchoToClaude(client: 'code' | 'desktop'): Promise<{ restart?: boolean; path?: string }> {
  const r = await ask({ cmd: 'add-to-claude', client });
  if (!r) throw new Error('Echo Helper is not installed. Turn agent mode on once to install it.');
  return r;
}
export async function setAppAgents(app: AppId, agents: string[]): Promise<string[]> {
  return (await ask({ cmd: 'app-agents', app, agents }))?.agents || [];
}

/** The AI key already saved in ECHO's own settings, if it is one agents can use. */
async function echoKey(): Promise<AiChoice | null> {
  const config = await getAuthConfig().catch(() => null);
  if (config?.geminiApiKey) return { provider: 'google', key: config.geminiApiKey };
  if (config?.anthropicApiKey) return { provider: 'anthropic', key: config.anthropicApiKey };
  return null;
}

export async function agentModeInfo(): Promise<{ helper: HelperInfo | null; echoKey: AiChoice['provider'] | null }> {
  const [helper, key] = await Promise.all([helperInfo().catch(() => null), echoKey()]);
  return { helper, echoKey: key?.provider ?? null };
}

/** What the helper sets up: every avatar, its tools and its instructions. */
function setupPayload() {
  return {
    commands: allCommands(),
    agents: AVATAR_AGENTS.map(a => ({
      agentId: a.agentId,
      allow: TOOL_NAMES.map(t => toolNameFor(a.slug, t)),
      files: { 'AGENTS.md': agentsMd(a), 'SOUL.md': soulMd(a), 'IDENTITY.md': identityMd(a) },
    })),
  };
}

/**
 * Turn agent mode on. Without the helper, the answer is its one-time install
 * command; without an AI set up in OpenClaw, ECHO asks for one (or uses the key
 * already saved in ECHO when `useEchoKey`). `progress` reports each step.
 */
export async function turnOnAgentMode(opts: { ai?: AiChoice; useEchoKey?: boolean },
  progress: (step: string) => void): Promise<TurnOnResult> {
  const info = await helperInfo();
  if (!info?.openclaw || info.outdated) {
    return { needsHelper: true, command: await helperInstallCommand(chrome.runtime.id, chrome.runtime.getManifest().version, claudeToolList()) };
  }
  let ai = opts.ai;
  if (!info.model && !ai && opts.useEchoKey) ai = (await echoKey()) ?? undefined;
  if (!info.model && !ai) return { needsAiKey: true };

  const { token, deviceId } = await prepareOpenClawPairing();
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: TurnOnResult) => { if (!settled) { settled = true; try { port.disconnect(); } catch { /* gone */ } resolve(result); } };
    const port = chrome.runtime.connectNative(HELPER_HOST);
    port.onMessage.addListener((m: any) => {
      if (m?.progress) {
        progress(m.progress);
        if (m.started) reconnectOpenClaw();   // the gateway is up: connect now
        return;
      }
      if (m?.error === 'NEEDS_AI_KEY') finish({ needsAiKey: true });
      else if (m?.error) finish({ error: m.error });
      else finish({ ok: true });
    });
    port.onDisconnect.addListener(() => finish({ error: chrome.runtime.lastError?.message || 'Echo Helper stopped before it finished.' }));
    port.postMessage({ id: 1, cmd: 'turn-on', token, deviceId, setup: setupPayload(), ...(ai ? { ai } : {}) });
  });
}

/** Turn agent mode off: stop OpenClaw's background service, and stop connecting to it. */
export async function turnOffAgentMode(): Promise<void> {
  await saveOpenClawSettings({ enabled: false });
  await ask({ cmd: 'turn-off' }).catch(() => null);
}
