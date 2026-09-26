// Agent mode: agents working on their own, each in the tab it was given, with
// an AI that runs through OpenClaw on this computer. One "Turn on" button: Echo
// Helper (installed once) does the setup, starts OpenClaw and approves this
// browser. Shared by the chat panel and the settings page.

import React, { useState } from 'react';
import './agent-setup.css';
import { type AgentMode, type AiProvider, PHASE_TEXT } from './agent-mode-client';

export { useAgentMode, agentPhase, PHASE_TEXT } from './agent-mode-client';
export type { AgentMode, AgentPhase, OpenClawStatus } from './agent-mode-client';

const INSTALL_GUIDE = 'https://docs.openclaw.ai/install';
const AI_NAMES: Record<AiProvider, string> = { google: 'Gemini', anthropic: 'Claude' };
const KEY_LINKS: Record<AiProvider, string> = { google: 'https://aistudio.google.com/apikey', anthropic: 'https://console.anthropic.com/settings/keys' };

/**
 * Agent mode's controls: Turn on (with the one-time helper install or an AI
 * key when needed), live progress, and once it is on, a short summary with
 * Turn off. `onDone` is offered as the next step (for example, assigning an agent).
 */
export function AgentSetup({ mode, onDone, doneLabel = 'Assign an agent' }: {
  mode: AgentMode; onDone?: () => void; doneLabel?: string;
}) {
  const { phase, helper, echoKey, busy, step, error, installCommand, needsKey, status } = mode;
  const [provider, setProvider] = useState<AiProvider>('google');
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {});

  if (busy) {
    return (
      <div className="agent-setup">
        <div className="agent-working" role="status" aria-live="polite">
          <i className="agent-spinner" aria-hidden="true" />
          <span><strong>Turning agent mode on…</strong><small>{step || 'Starting…'}</small></span>
        </div>
        <p className="agent-note">This takes about a minute. You can keep using Chrome.</p>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className="agent-setup done">
        <div className="agent-done-row">
          <span className="agent-check" aria-hidden="true">✓</span>
          <span>
            <strong>Agent mode is on</strong>
            <small>Agents run on OpenClaw{status?.serverVersion ? ` ${status.serverVersion}` : ''} on this computer{helper?.model ? `, with ${helper.model}` : ''}.</small>
          </span>
        </div>
        <div className="agent-buttons">
          {onDone && <button className="agent-primary" onClick={onDone}>{doneLabel}</button>}
          <button className="agent-secondary" onClick={mode.turnOff}>Turn off</button>
        </div>
      </div>
    );
  }

  if (installCommand) {
    return (
      <div className="agent-setup">
        <p className="agent-intro">
          <strong>One time only:</strong> Echo needs its small helper on this computer. Chrome doesn't let
          extensions install programs, so this one step happens in Terminal. After it, Turn on and Turn off are just buttons.
        </p>
        <ol className="agent-steps">
          <li className={copied ? 'done' : 'current'}>
            <span className="agent-step-num">1</span>
            <span className="agent-step-body">
              <strong>Copy the install command</strong>
              <button className="agent-primary" onClick={() => copy(installCommand)}>{copied ? 'Copied ✓' : 'Copy command'}</button>
            </span>
          </li>
          <li className={copied ? 'current' : ''}>
            <span className="agent-step-num">2</span>
            <span className="agent-step-body">
              <strong>Paste it in Terminal and press Return</strong>
              <small>Open Terminal with ⌘ Space, then type Terminal. It installs OpenClaw (free, open source) if needed, and the helper.</small>
            </span>
          </li>
          <li className={copied ? 'current' : ''}>
            <span className="agent-step-num">3</span>
            <span className="agent-step-body">
              <strong>Echo carries on by itself</strong>
              <span className="agent-progress off" role="status" aria-live="polite"><i aria-hidden="true" />Waiting for Echo Helper…</span>
            </span>
          </li>
        </ol>
        <p className="agent-note">Needs macOS or Linux. <a href={INSTALL_GUIDE} target="_blank" rel="noopener noreferrer">About OpenClaw</a></p>
      </div>
    );
  }

  if (needsKey) {
    return (
      <form className="agent-setup" onSubmit={e => { e.preventDefault(); if (key.trim()) mode.turnOn({ ai: { provider, key: key.trim() } }); }}>
        <p className="agent-intro"><strong>Which AI should your agents use?</strong> OpenClaw keeps the key on this computer.</p>
        <div className="agent-segment" role="radiogroup" aria-label="AI">
          {(Object.keys(AI_NAMES) as AiProvider[]).map(p => (
            <button key={p} type="button" role="radio" aria-checked={provider === p} className={provider === p ? 'on' : ''}
              onClick={() => setProvider(p)}>{AI_NAMES[p]}{p === 'google' ? ' · free tier' : ''}</button>
          ))}
        </div>
        <label className="agent-field">
          <span>{AI_NAMES[provider]} API key · <a href={KEY_LINKS[provider]} target="_blank" rel="noopener noreferrer">get one</a></span>
          <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste the key" autoFocus />
        </label>
        {error && <div className="agent-error" role="alert">{error}</div>}
        <div className="agent-buttons">
          <button className="agent-primary" type="submit" disabled={!key.trim()}>Turn on</button>
        </div>
      </form>
    );
  }

  return (
    <div className="agent-setup">
      <p className="agent-intro">
        Agents work on their own, each in the tab you assign it, with an AI that runs through OpenClaw
        (free and open source) on this computer.
      </p>
      <div className="agent-buttons">
        <button className="agent-primary big" onClick={() => mode.turnOn({ useEchoKey: true })}>Turn on agent mode</button>
      </div>
      {phase !== 'off' && <p className="agent-note">{PHASE_TEXT[phase].title}</p>}
      {helper === null && <p className="agent-note">The first time, Echo asks you to install its helper once.</p>}
      {helper?.openclaw && !helper.model && echoKey && <p className="agent-note">Uses the {AI_NAMES[echoKey]} key already saved in Echo.</p>}
      {error && <div className="agent-error" role="alert">{error}</div>}
      <Advanced open={advanced} onToggle={() => setAdvanced(o => !o)}>
        <AdvancedOptions mode={mode} />
      </Advanced>
    </div>
  );
}

/** For people who run OpenClaw their own way. */
function AdvancedOptions({ mode }: { mode: AgentMode }) {
  const [token, setToken] = useState('');
  const [url, setUrl] = useState(mode.status?.url || '');
  const [note, setNote] = useState('');
  const save = (patch: Record<string, unknown>) => chrome.runtime.sendMessage({ type: 'ECHO_OPENCLAW_SAVE', ...patch })
    .then((r: any) => setNote(r?.success ? 'Saved.' : r?.error || 'Could not save.')).catch(() => {});
  const copySetup = () => chrome.runtime.sendMessage({ type: 'ECHO_OPENCLAW_SETUP_COMMAND' })
    .then((r: any) => r?.success && navigator.clipboard.writeText(r.command))
    .then(() => setNote('Full setup command copied: paste it in Terminal.')).catch(() => {});
  return (<>
    <label className="agent-field">
      <span>OpenClaw address</span>
      <input value={url} onChange={e => setUrl(e.target.value)} onBlur={() => url && url !== mode.status?.url && save({ url })} />
    </label>
    <form className="agent-field" onSubmit={e => { e.preventDefault(); if (token.trim()) { save({ enabled: true, sharedToken: token.trim() }); setToken(''); } }}>
      <span>Run OpenClaw yourself? Paste its token</span>
      <span className="agent-inline">
        <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="openclaw --profile echo gateway auth-token --show" />
        <button type="submit" className="agent-link" disabled={!token.trim()}>Use</button>
      </span>
    </form>
    <button className="agent-link" onClick={copySetup}>Copy the full setup command instead (Terminal)</button>
    {note && <span className="agent-note">{note}</span>}
  </>);
}

function Advanced({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="agent-advanced">
      <button className="agent-link" aria-expanded={open} onClick={onToggle}>{open ? 'Hide advanced' : 'Advanced'}</button>
      {open && <div className="agent-advanced-body">{children}</div>}
    </div>
  );
}
