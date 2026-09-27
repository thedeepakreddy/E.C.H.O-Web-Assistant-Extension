// Apps agents can use: email and GitHub, connected through Echo Helper. The
// password or token goes straight to the helper, which keeps it in a file only
// this user can read; ECHO keeps nothing. Every email an agent sends and every
// post it makes still asks for Allow in ECHO.

import React, { useEffect, useState } from 'react';
import './agent-setup.css';
import type { AgentMode } from './agent-mode-client';
import { AVATAR_AGENTS } from '../background/openclaw/registry';

type AppId = 'mail' | 'github';
interface AppInfo { available: boolean; connected: boolean; account?: string; agents?: string[] }
type Apps = Record<AppId, AppInfo>;

const PROVIDERS = {
  gmail: { name: 'Gmail', help: 'https://myaccount.google.com/apppasswords', note: 'Needs 2-Step Verification on your Google account.' },
  icloud: { name: 'iCloud', help: 'https://account.apple.com/account/manage', note: 'Sign-In and Security → App-Specific Passwords.' },
  yahoo: { name: 'Yahoo', help: 'https://login.yahoo.com/account/security', note: 'Account security → Generate app password.' },
  custom: { name: 'Other', help: '', note: 'Your provider\'s IMAP and SMTP server names.' },
} as const;
type Provider = keyof typeof PROVIDERS;

const apps = (action: string, extra: Record<string, unknown> = {}) => chrome.runtime.sendMessage({ type: 'ECHO_APPS', action, ...extra }) as Promise<any>;

export function AppsSetup({ mode }: { mode: AgentMode }) {
  const [state, setState] = useState<Apps | null>(null);
  const [error, setError] = useState('');
  const refresh = () => apps('status').then(r => { if (r?.success && r.apps) setState(r.apps); else if (r?.error) setError(r.error); }).catch(() => {});
  useEffect(() => { refresh(); }, [mode.phase]);

  if (mode.phase !== 'ready') return <p className="agent-note">Turn agent mode on to connect email and GitHub for your agents.</p>;
  if (!state) return <p className="agent-note">{error || 'Checking apps…'}</p>;
  const outdated = !state.mail?.available && !state.github?.available;
  if (outdated || mode.helper?.outdated) {
    return (
      <div className="agent-setup">
        <p className="agent-intro">Apps need the newest Echo Helper. Install it again (one command), then come back here.</p>
        <div className="agent-buttons"><button className="agent-primary" onClick={() => mode.turnOn({ useEchoKey: true })}>Update Echo Helper</button></div>
      </div>
    );
  }
  // Connected apps with no way to ask: ECHO paired before approvals existed. Turn on grants it.
  const cannotAsk = mode.status?.approvals === false && (state.mail?.connected || state.github?.connected);
  return (
    <div className="apps">
      {cannotAsk && (
        <div className="agent-error" role="alert">
          Agents can't ask you before sending yet, so ECHO blocks every send.{' '}
          <button className="agent-link" onClick={() => mode.turnOn({ useEchoKey: true })}>Turn agent mode on again</button> to fix it (about a minute).
        </div>
      )}
      <MailCard info={state.mail} onChange={refresh} />
      <GitHubCard info={state.github} onChange={refresh} />
    </div>
  );
}

function AgentChoice({ app, agents, onChange }: { app: AppId; agents: string[]; onChange: () => void }) {
  const [chosen, setChosen] = useState(agents);
  const [note, setNote] = useState('');
  useEffect(() => setChosen(agents), [agents.join(',')]);
  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter(a => a !== id) : [...chosen, id];
    setChosen(next);
    apps('agents', { app, agents: next }).then(r => { setNote(r?.success ? '' : r?.error || 'Could not save.'); if (r?.success) onChange(); }).catch(() => {});
  };
  return (
    <div className="app-agents">
      <span>Agents that can use it</span>
      <div className="app-agent-chips">
        {AVATAR_AGENTS.map(a => (
          <button key={a.agentId} type="button" className={chosen.includes(a.agentId) ? 'on' : ''} aria-pressed={chosen.includes(a.agentId)}
            onClick={() => toggle(a.agentId)}>{a.tagline}</button>
        ))}
      </div>
      {note && <div className="agent-error" role="alert">{note}</div>}
    </div>
  );
}

function Connected({ app, info, what, onChange }: { app: AppId; info: AppInfo; what: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="agent-done-row">
        <span className="agent-check" aria-hidden="true">✓</span>
        <span><strong>Connected{info.account ? ` as ${info.account}` : ''}</strong><small>{what}</small></span>
      </div>
      <AgentChoice app={app} agents={info.agents || []} onChange={onChange} />
      <button className="agent-link danger" disabled={busy}
        onClick={() => { setBusy(true); apps('disconnect', { app }).finally(() => { setBusy(false); onChange(); }); }}>Disconnect</button>
    </>
  );
}

function MailCard({ info, onChange }: { info: AppInfo; onChange: () => void }) {
  const [provider, setProvider] = useState<Provider>('gmail');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    apps('connect', { app: 'mail', provider, address: address.trim(), password, ...(provider === 'custom' ? { imapHost, smtpHost } : {}) })
      .then(r => { if (r?.success) { setPassword(''); onChange(); } else setError(r?.error || 'Could not connect.'); })
      .catch(() => setError('Could not reach Echo Helper.'))
      .finally(() => setBusy(false));
  };
  const p = PROVIDERS[provider];
  return (
    <section className="app-card">
      <h4>Email</h4>
      {info.connected ? (
        <Connected app="mail" info={info} what="Agents can search and read your mail. Each email they send asks you first." onChange={onChange} />
      ) : !info.available ? (
        <p className="agent-note">The email app's libraries are missing. Install Echo Helper again from Agent mode.</p>
      ) : (
        <form className="agent-setup" onSubmit={connect}>
          <p className="agent-intro">Agents search, read and (after you allow it) send mail from your address. Use an <b>app password</b>, not your usual password.</p>
          <div className="agent-segment" role="radiogroup" aria-label="Email provider">
            {(Object.keys(PROVIDERS) as Provider[]).map(k => (
              <button key={k} type="button" role="radio" aria-checked={provider === k} className={provider === k ? 'on' : ''} onClick={() => setProvider(k)}>{PROVIDERS[k].name}</button>
            ))}
          </div>
          <label className="agent-field"><span>Email address</span>
            <input type="email" autoComplete="off" value={address} onChange={e => setAddress(e.target.value)} placeholder="you@example.com" /></label>
          {provider === 'custom' && (
            <div className="agent-inline">
              <label className="agent-field"><span>IMAP server</span><input value={imapHost} onChange={e => setImapHost(e.target.value)} placeholder="imap.example.com" /></label>
              <label className="agent-field"><span>SMTP server</span><input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.example.com" /></label>
            </div>
          )}
          <label className="agent-field">
            <span>App password{p.help ? <> · <a href={p.help} target="_blank" rel="noopener noreferrer">make one</a></> : null}</span>
            <input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" />
          </label>
          <p className="agent-note">{p.note}</p>
          {error && <div className="agent-error" role="alert">{error}</div>}
          <div className="agent-buttons">
            <button className="agent-primary" type="submit" disabled={busy || !address.trim() || !password.trim() || (provider === 'custom' && (!imapHost || !smtpHost))}>
              {busy ? 'Signing in…' : 'Connect email'}</button>
          </div>
        </form>
      )}
    </section>
  );
}

function GitHubCard({ info, onChange }: { info: AppInfo; onChange: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = (req: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    apps('connect', { app: 'github', ...req })
      .then(r => { if (r?.success) { setToken(''); onChange(); } else setError(r?.error || 'Could not connect.'); })
      .catch(() => setError('Could not reach Echo Helper.'))
      .finally(() => setBusy(false));
  };
  return (
    <section className="app-card">
      <h4>GitHub</h4>
      {info.connected ? (
        <Connected app="github" info={info} what="Agents can read repositories, issues and pull requests, and open or comment on issues after you allow it. They can't push, merge or delete." onChange={onChange} />
      ) : (
        <div className="agent-setup">
          <p className="agent-intro">Agents read your repositories and issues, and post issues and comments after you allow each one.</p>
          <div className="agent-buttons">
            <button className="agent-secondary" disabled={busy} onClick={() => connect({ source: 'gh' })}>{busy ? 'Signing in…' : 'Use my GitHub CLI sign-in'}</button>
          </div>
          <form className="agent-field" onSubmit={e => { e.preventDefault(); if (token.trim()) connect({ token: token.trim() }); }}>
            <span>Or a GitHub token · <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">make one</a> (Issues: read and write; Contents, Pull requests: read)</span>
            <span className="agent-inline">
              <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_…" />
              <button type="submit" className="agent-primary" disabled={busy || !token.trim()}>Connect</button>
            </span>
          </form>
          {error && <div className="agent-error" role="alert">{error}</div>}
        </div>
      )}
    </section>
  );
}
