// Agent mode, as the UI sees it: whether it is on, whether Echo Helper is on
// this computer, and the Turn on / Turn off buttons with their live progress.
// No styles here, so the in-page ECHO panel can use it as well.

import { useEffect, useRef, useState } from 'react';

type GatewayState =
  | { kind: 'connecting' | 'connected' | 'stopped' }
  | { kind: 'pairing-required'; requestId?: string }
  | { kind: 'error'; code?: string; message?: string };

export interface OpenClawStatus {
  enabled: boolean; url: string; hasToken: boolean; node: GatewayState; operator: GatewayState;
  serverVersion?: string; testedVersion: string; commands: { state: string; requestId?: string }; ready: boolean; approvals?: boolean;
}

export interface HelperInfo { helper: number; outdated?: boolean; openclaw: { version: string } | null; running?: boolean; model?: string | null }

/** Where agent mode stands, in the words the user sees. */
export type AgentPhase = 'off' | 'not-running' | 'needs-setup' | 'connecting' | 'approving' | 'ready';

export function agentPhase(s: OpenClawStatus | null): AgentPhase {
  if (!s || !s.enabled) return 'off';
  if (s.ready) return 'ready';
  const roles = [s.operator, s.node];
  if (roles.some(r => r.kind === 'pairing-required') || (s.node.kind === 'connected' && s.commands.state === 'pending')) return 'approving';
  const code = roles.map(r => (r.kind === 'error' ? r.code || 'ERROR' : '')).find(Boolean) || '';
  if (/CLOSED|SOCKET|CONNECT|UNREACHABLE|TIMEOUT/.test(code)) return 'not-running';
  // Too many tries while setup was running: ECHO waits a minute and tries again by itself.
  if (code === 'AUTH_RATE_LIMITED') return 'connecting';
  if (code) return 'needs-setup';
  return 'connecting';
}

export const PHASE_TEXT: Record<AgentPhase, { title: string; detail: string }> = {
  off: { title: 'Agent mode is off', detail: 'Agents use Echo\'s built-in brain.' },
  'not-running': { title: 'OpenClaw isn\'t running', detail: 'Turn agent mode on again to start it.' },
  'needs-setup': { title: 'Setup isn\'t finished', detail: 'Turn agent mode on to finish.' },
  connecting: { title: 'Connecting to OpenClaw…', detail: 'This can take up to a minute.' },
  approving: { title: 'Approving this browser…', detail: 'Echo Helper does this for you.' },
  ready: { title: 'Agent mode is on', detail: 'Agents run on OpenClaw on this computer.' },
};

export type AiProvider = 'google' | 'anthropic';

export interface AgentMode {
  status: OpenClawStatus | null;
  phase: AgentPhase;
  /** Echo Helper's report; null when it is not installed; undefined until known. */
  helper: HelperInfo | null | undefined;
  /** An AI key ECHO already has that agents can use. */
  echoKey: AiProvider | null;
  busy: boolean;
  step: string;
  error: string;
  /** Set when the helper must be installed first (the one-time command). */
  installCommand: string;
  /** Set when OpenClaw has no AI yet and ECHO has none to offer. */
  needsKey: boolean;
  turnOn: (opts?: { ai?: { provider: AiProvider; key: string }; useEchoKey?: boolean }) => Promise<void>;
  turnOff: () => Promise<void>;
}

/** Agent mode's live state, refreshed on every change the background reports. */
export function useAgentMode(pollMs = 3000): AgentMode {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [helper, setHelper] = useState<HelperInfo | null | undefined>(undefined);
  const [echoKey, setEchoKey] = useState<AiProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const live = useRef(true);

  const refresh = () => {
    chrome.runtime.sendMessage({ type: 'ECHO_OPENCLAW_STATUS' })
      .then((r: any) => { if (live.current && r?.success) setStatus(r.status); }).catch(() => {});
  };
  const refreshHelper = () => {
    chrome.runtime.sendMessage({ type: 'ECHO_AGENT_MODE', action: 'status' })
      .then((r: any) => { if (live.current && r?.success) { setHelper(r.helper); setEchoKey(r.echoKey); } }).catch(() => {});
  };

  useEffect(() => {
    live.current = true;
    refresh();
    refreshHelper();
    const onMessage = (m: any) => {
      if (m?.type === 'ECHO_OPENCLAW_STATUS_CHANGED') refresh();
      if (m?.type === 'ECHO_AGENT_MODE_PROGRESS' && typeof m.step === 'string') setStep(m.step);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    const timer = setInterval(refresh, pollMs);
    return () => { live.current = false; chrome.runtime.onMessage.removeListener(onMessage); clearInterval(timer); };
  }, [pollMs]);

  // While the one-time install is pending, notice the helper as soon as it arrives.
  useEffect(() => {
    if (!installCommand) return;
    const timer = setInterval(refreshHelper, 2500);
    return () => clearInterval(timer);
  }, [installCommand]);

  // The helper just arrived (its one-time install finished): carry on turning on.
  useEffect(() => {
    if (installCommand && helper?.openclaw && !helper.outdated && !busy) turnOn();
  }, [helper, installCommand]);

  const turnOn: AgentMode['turnOn'] = async (opts = {}) => {
    setBusy(true);
    setError('');
    setStep('Starting…');
    try {
      const r: any = await chrome.runtime.sendMessage({ type: 'ECHO_AGENT_MODE', action: 'turn-on', useEchoKey: true, ...opts });
      if (!r?.success) throw new Error(r?.error || 'Could not turn agent mode on.');
      if (r.needsHelper) { setInstallCommand(r.command); setNeedsKey(false); return; }
      setInstallCommand('');
      if (r.needsAiKey) { setNeedsKey(true); return; }
      if (r.error) throw new Error(r.error);
      setNeedsKey(false);
    } catch (e: any) {
      setError(e?.message || 'Could not turn agent mode on.');
    } finally {
      setBusy(false);
      setStep('');
      refresh();
      refreshHelper();
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError('');
    try {
      await chrome.runtime.sendMessage({ type: 'ECHO_AGENT_MODE', action: 'turn-off' });
    } finally {
      setBusy(false);
      refresh();
      refreshHelper();
    }
  };

  return { status, phase: agentPhase(status), helper, echoKey, busy, step, error, installCommand, needsKey, turnOn, turnOff };
}
