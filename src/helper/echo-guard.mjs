// Echo guard: an OpenClaw plugin, installed with Echo Helper, that asks the user
// in ECHO before an ECHO agent causes a consequential change through a connected app
// (an MCP server such as email or GitHub). It follows the same rule as ECHO's
// browser actions. OpenClaw blocks the call when nobody can answer, or on Deny.

const ECHO_AGENT = /^echo(-[a-z]+)?$/;
// How long OpenClaw waits for an answer. ECHO's prompt closes (as Deny) sooner,
// so a late click never acts.
export const APPROVAL_WAIT_MS = 60_000;

// Tool names are "<app>__<tool>" (OpenClaw's names for MCP tools), and a tool's
// name starts with what it does: send_email, create_issue, list_messages.
const SEND_VERBS = new Set(['send', 'reply', 'respond', 'forward', 'post', 'publish', 'tweet', 'retweet', 'comment',
  'notify', 'invite', 'share', 'dm', 'message', 'broadcast', 'announce', 'email', 'mail']);
const PAY_VERBS = new Set(['pay', 'purchase', 'buy', 'checkout', 'order', 'subscribe', 'donate', 'transfer', 'charge', 'refund', 'tip']);
const CHANGE_VERBS = new Set(['update', 'edit', 'delete', 'remove', 'close', 'reopen', 'merge', 'cancel', 'grant', 'revoke',
  'assign', 'unassign', 'archive', 'restore', 'set', 'change', 'disable', 'enable']);
// Creating one of these puts words in front of other people.
const POSTED_THINGS = /^(issue|comment|review|discussion|reply|pull_request|pr|message|post|email|mail|tweet)s?$/;
const MONEY = /(^|_)(payment|money|funds)(_|$)/;

/** What an app tool does, as far as asking goes. Unknown/read-only tools run without asking. */
export function classifyAppTool(toolName, params = {}) {
  const [app, tool] = String(toolName || '').split('__');
  if (!app || !tool) return null;
  const words = tool.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').split(/[_-]+/).filter(Boolean);
  const [verb, ...rest] = words;
  if (!verb) return null;
  // One tool, several actions ("issue_write" with method "create"): the action decides.
  if (['write', 'manage', 'mutate'].includes(words.at(-1)) && words.length > 1) {
    const action = String(params?.method ?? params?.action ?? params?.operation ?? '').toLowerCase();
    const thing = words.slice(0, -1).join('_');
    const posts = POSTED_THINGS.test(thing) || /^pull_request(_review)?$/.test(thing);
    if (posts && /^(create|add|submit|post|reply|comment)/.test(action)) return 'message';
    return /^(update|edit|delete|remove|close|reopen|merge|cancel|grant|revoke|assign|unassign|archive|restore|set|change|disable|enable)/.test(action)
      ? 'change' : null;
  }
  // Saving a draft sends nothing; "send_draft" sends.
  if (rest.includes('draft') || rest.includes('drafts')) return verb === 'send' ? 'message' : null;
  const object = rest.join('_');
  if (PAY_VERBS.has(verb) || (['send', 'make', 'create', 'submit'].includes(verb) && MONEY.test(object))
    || (['place', 'make', 'submit', 'complete', 'confirm'].includes(verb) && /(^|_)(order|purchase|payment)s?(_|$)/.test(object))) return 'payment';
  if (SEND_VERBS.has(verb)) return 'message';
  if (['create', 'add', 'submit', 'open', 'write'].includes(verb)
    && (rest.some(w => POSTED_THINGS.test(w)) || /(^|_)pull_request(_|$)/.test(object))) return 'message';
  if (CHANGE_VERBS.has(verb)) return 'change';
  return null;
}

const APP_NAMES = { mail: 'Email', email: 'Email', gmail: 'Gmail', github: 'GitHub', slack: 'Slack' };
export function appName(toolName) {
  const app = String(toolName || '').split('__')[0].replace(/^echo-/, '');
  return APP_NAMES[app.toLowerCase()] || app.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

const clip = (value, n) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const list = value => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).map(v => clip(v, 128)).filter(Boolean);

function recipientsOf(p) {
  return [...list(p.to), ...list(p.cc), ...list(p.bcc), ...list(p.recipients), ...list(p.recipient), ...list(p.email), ...list(p.channel)];
}

/** The approval OpenClaw shows: short, specific, and without secrets. */
export function approvalRequest(toolName, params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const kind = classifyAppTool(toolName, p);
  if (!kind) return null;
  const app = appName(toolName);
  if (kind === 'payment') {
    const amount = p.amount ?? p.total ?? p.price;
    const currency = clip(p.currency || '', 12);
    const payee = clip(p.payee || p.merchant || p.to || app, 128);
    return {
      title: `Pay with ${app}`,
      description: clip(`Pay ${amount != null ? `${amount}${currency ? ` ${currency}` : ''} ` : ''}to ${payee} with ${app}.`, 500),
      severity: 'critical',
      ...(amount != null && currency ? { scope: { kind: 'payment', amount: clip(amount, 40), currency, target: payee } } : {}),
    };
  }
  if (kind === 'change') {
    const repo = p.owner && p.repo ? `${p.owner}/${p.repo}` : clip(p.repo || p.repository || '', 128);
    const target = clip(repo || p.name || p.title || p.id || app, 128);
    return {
      title: `Change with ${app}`,
      description: clip(`Allow ${String(toolName).split('__').at(-1).replace(/[_-]+/g, ' ')} on ${target}.`, 500),
      detail: clip(p.body || p.text || p.message || '', 4000) || undefined,
      severity: 'warning',
      scope: { kind: 'external-change', target: clip(`${app} ${target}`, 128) },
    };
  }
  const repo = p.owner && p.repo ? `${p.owner}/${p.repo}` : clip(p.repo || p.repository || '', 128);
  if (repo) {
    const what = /comment/i.test(toolName) ? 'a comment' : /review/i.test(toolName) ? 'a review' : /pull_?request|_pr(_|$)/i.test(toolName) ? 'a pull request' : 'an issue';
    const title = clip(p.title || '', 120);
    return {
      title: `Post on ${app}`,
      description: clip(`Post ${what} on ${repo}${p.issue_number || p.pullNumber || p.pull_number ? ` #${p.issue_number || p.pullNumber || p.pull_number}` : ''}${title ? `: "${title}"` : ''}.`, 500),
      detail: clip(p.body || '', 4000) || undefined,
      severity: 'warning',
      scope: { kind: 'external-post', target: clip(`${app} ${repo}`, 128), visibility: 'public' },
    };
  }
  const recipients = recipientsOf(p);
  const subject = clip(p.subject || p.title || '', 120);
  const who = recipients.length ? recipients.slice(0, 3).join(', ') + (recipients.length > 3 ? ` and ${recipients.length - 3} more` : '') : 'someone';
  return {
    title: `Send with ${app}`,
    description: clip(`Send ${/^(email|gmail)$/i.test(app) || /mail/i.test(toolName) ? 'an email' : 'a message'} to ${who}${subject ? `, subject "${subject}"` : ''}.`, 500),
    detail: clip(p.body || p.text || p.message || '', 4000) || undefined,
    severity: 'warning',
    scope: { kind: 'message-send', target: clip(app, 128), recipientCount: Math.max(1, recipients.length), ...(recipients.length ? { recipients: recipients.slice(0, 5) } : {}) },
  };
}

/** The before_tool_call hook: ECHO's agents, app tools only (ECHO's own browser tools ask in ECHO already). */
export function beforeToolCall(event, ctx) {
  if (!ECHO_AGENT.test(String(ctx?.agentId || ''))) return undefined;
  if (!String(event?.toolName || '').includes('__')) return undefined;
  const request = approvalRequest(event.toolName, event.params);
  if (!request) return undefined;
  return { requireApproval: { ...request, allowedDecisions: ['allow-once', 'deny'], timeoutMs: APPROVAL_WAIT_MS } };
}

export default {
  id: 'echo-guard',
  name: 'Echo guard',
  description: 'Asks the user in ECHO before an ECHO agent sends or pays through a connected app.',
  configSchema: { type: 'object', additionalProperties: false, properties: {} },
  register(api) {
    api.on('before_tool_call', beforeToolCall);
  },
};
