// Approvals for what ECHO's agents do in connected apps (email, GitHub…). Echo
// guard, a plugin on ECHO's OpenClaw gateway, pauses a consequential action and
// asks every approval client; ECHO is one. It shows its usual Allow / Deny, in
// the agent's tab and the chat panel, and answers the gateway. No answer in
// time, a stop, or a closed ECHO all mean Deny: the gateway blocks the call.

import type { ApprovalOutcome } from '../safety';

type Kind = 'message' | 'payment';

export interface AppApprovalHost {
  /** The tab the agent works in, if it has one. */
  tabOf(agentId: string): number | undefined;
  /** ECHO's Allow prompt. It ends early (as 'stopped') when `signal` aborts. */
  ask(p: { kind: Kind; detail: string; app: string; tabId?: number; timeoutMs: number; signal: AbortSignal }): Promise<ApprovalOutcome>;
  log(kind: Kind, detail: string, outcome: 'approved' | 'denied'): void;
}

export interface ApprovalConnection {
  request(method: string, params: unknown): Promise<unknown>;
}

/** Answer this long before the gateway gives up, so a click is never too late. */
const MARGIN_MS = 5_000;
const ECHO_AGENT = /^echo(-[a-z]+)?$/;

const KIND_OF_SCOPE: Record<string, Kind> = {
  payment: 'payment', 'message-send': 'message', 'external-post': 'message', 'external-change': 'message',
};

/** The app a request is for, from the tool's name ("gmail__send_email" → "Gmail") unless its scope names it. */
function appOf(request: any): string {
  const target = request?.scope?.kind === 'message-send' ? String(request.scope.target || '') : '';
  if (target) return target.slice(0, 40);
  const app = String(request?.toolName || '').split('__')[0].replace(/^echo-/, '');
  return app === 'mail' ? 'Email' : app === 'github' ? 'GitHub' : (app.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()) || 'an app');
}

export function createAppApprovals(conn: ApprovalConnection, host: AppApprovalHost) {
  const open = new Map<string, AbortController>();

  async function ask(entry: any): Promise<void> {
    const id = String(entry?.id || '');
    const request = entry?.request || {};
    if (!id.startsWith('plugin:') || open.has(id)) return;
    // Only what Echo guard asks for ECHO's own agents.
    if (request.pluginId !== 'echo-guard' || !ECHO_AGENT.test(String(request.agentId || ''))) return;
    const controller = new AbortController();
    open.set(id, controller);
    const kind: Kind = KIND_OF_SCOPE[String(request.scope?.kind)] || (request.severity === 'critical' ? 'payment' : 'message');
    const detail = String(request.description || request.title || 'An agent wants to send something').replace(/\.$/, '');
    const expires = Number(entry.expiresAtMs) || Date.now() + 60_000;
    let outcome: ApprovalOutcome = 'timeout';
    try {
      outcome = await host.ask({ kind, detail, app: appOf(request), tabId: host.tabOf(String(request.agentId)),
        timeoutMs: expires - Date.now() - MARGIN_MS, signal: controller.signal });
    } catch { /* treated as no answer */ }
    // Answered by another approval client, or the gateway gave up: nothing to send.
    if (controller.signal.aborted) return;
    open.delete(id);
    const approved = outcome === 'approved';
    host.log(kind, detail, approved ? 'approved' : 'denied');
    await conn.request('plugin.approval.resolve', { id, decision: approved ? 'allow-once' : 'deny' }).catch(() => {});
  }

  return {
    handleEvent(event: { event: string; payload?: any }): void {
      if (event.event === 'plugin.approval.requested') { ask(event.payload).catch(() => {}); return; }
      if (event.event === 'plugin.approval.resolved' || event.event === 'plugin.approval.removed') {
        const id = String(event.payload?.id || '');
        const controller = open.get(id);
        if (controller) { open.delete(id); controller.abort(); }
      }
    },
    /** After a (re)connect: ask about anything still waiting for an answer. */
    async resume(): Promise<void> {
      const pending: any = await conn.request('plugin.approval.list', {}).catch(() => []);
      for (const entry of Array.isArray(pending) ? pending : []) {
        if ((Number(entry?.expiresAtMs) || 0) - Date.now() > MARGIN_MS * 2) ask(entry).catch(() => {});
      }
    },
    pending: () => open.size,
  };
}
