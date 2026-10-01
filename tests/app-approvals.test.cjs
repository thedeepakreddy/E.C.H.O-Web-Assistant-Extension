const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');

// Agents' actions in connected apps (email, GitHub…) ask for Allow exactly
// like browser actions: only sending and paying ask. Echo guard (an OpenClaw
// plugin) decides and pauses the call; ECHO shows the prompt and answers.

const guard = () => import(pathToFileURL(path.join(__dirname, '..', 'src/helper/echo-guard.mjs')).href);

function loadTs(file, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: () => ({}), console, Date, Map, Set, JSON, Promise, Math, Number, String, Array, Object,
    Error, RegExp, setTimeout, clearTimeout, AbortController, ...globals }, { filename: file });
  return exports;
}
const settle = (ms = 20) => new Promise(r => setTimeout(r, ms));

test('guard: sending, paying and remote mutations ask; reads and drafts run', async () => {
  const { classifyAppTool } = await guard();
  const expect = {
    'echo-mail__send_email': 'message', 'echo-mail__reply_email': 'message', 'echo-mail__send_draft': 'message',
    'slack__post_message': 'message', 'github__create_issue': 'message', 'github__add_issue_comment': 'message',
    'github__create_pull_request': 'message', 'shop__place_order': 'payment', 'stripe__create_payment': 'payment',
    'shop__buy_item': 'payment',
    'echo-mail__search_emails': null, 'echo-mail__read_email': null, 'echo-mail__mark_email_read': null,
    'echo-mail__create_draft': null, 'echo-mail__delete_email': 'change', 'github__list_issues': null,
    'github__update_issue': 'change', 'github__merge_pull_request': 'change', 'stripe__list_payments': null,
    // ECHO's own browser tools ask in ECHO already; they are not app tools.
    'analyst_act': null, 'style_navigate': null,
  };
  for (const [tool, kind] of Object.entries(expect)) assert.equal(classifyAppTool(tool), kind, tool);
  assert.equal(classifyAppTool('github__issue_write', { method: 'create' }), 'message');
  assert.equal(classifyAppTool('github__issue_write', { method: 'close' }), 'change');
});

test('guard: the prompt says who, what and where, never the whole payload', async () => {
  const { approvalRequest, beforeToolCall } = await guard();
  const mail = approvalRequest('echo-mail__send_email', { to: ['bob@example.com', 'amy@example.com'], subject: 'Lunch', body: 'See you at noon' });
  assert.equal(mail.title, 'Send with Email');
  assert.match(mail.description, /bob@example\.com, amy@example\.com, subject "Lunch"/);
  assert.equal(mail.detail, 'See you at noon', 'the body is shown to the reviewer only');
  assert.deepEqual(mail.scope, { kind: 'message-send', target: 'Email', recipientCount: 2, recipients: ['bob@example.com', 'amy@example.com'] });
  const post = approvalRequest('github__add_issue_comment', { owner: 'octo', repo: 'hello', issue_number: 7, body: 'Thanks!' });
  assert.match(post.description, /comment on octo\/hello #7/);
  assert.equal(post.scope.kind, 'external-post');
  const long = approvalRequest('echo-mail__send_email', { to: 'x@example.com', subject: 'S'.repeat(900) });
  assert.ok(long.description.length <= 500);

  const hook = beforeToolCall({ toolName: 'echo-mail__send_email', params: { to: ['bob@example.com'] } }, { agentId: 'echo-style' });
  assert.deepEqual(hook.requireApproval.allowedDecisions, ['allow-once', 'deny'], 'each send asks again: no "always"');
  assert.equal(beforeToolCall({ toolName: 'echo-mail__send_email', params: {} }, { agentId: 'main' }), undefined, 'only ECHO\'s agents');
  assert.equal(beforeToolCall({ toolName: 'echo-mail__search_emails', params: {} }, { agentId: 'echo' }), undefined);
});

/** ECHO's side, with a fake gateway connection and a fake prompt. */
function approvalsHarness(answer = 'approved') {
  const { createAppApprovals } = loadTs('src/background/openclaw/app-approvals.ts');
  const calls = [];
  const asked = [];
  const logged = [];
  const conn = { request: async (method, params) => { calls.push({ method, params }); return method === 'plugin.approval.list' ? [] : { ok: true }; } };
  const host = {
    tabOf: agentId => (agentId === 'echo-style' ? 42 : undefined),
    ask: p => { asked.push(p); return typeof answer === 'function' ? answer(p) : Promise.resolve(answer); },
    log: (kind, detail, outcome) => logged.push({ kind, detail, outcome }),
  };
  return { approvals: createAppApprovals(conn, host), calls, asked, logged };
}
const requested = (over = {}) => ({ event: 'plugin.approval.requested', payload: {
  id: 'plugin:abc', expiresAtMs: Date.now() + 60_000,
  request: { pluginId: 'echo-guard', agentId: 'echo-style', toolName: 'echo-mail__send_email', title: 'Send with Email',
    description: 'Send a message to bob@example.com, subject "Lunch".', scope: { kind: 'message-send', target: 'Email', recipientCount: 1 }, ...over },
} });

test('ECHO asks in the agent\'s tab and answers the gateway: Allow once', async () => {
  const { approvals, calls, asked, logged } = approvalsHarness('approved');
  approvals.handleEvent(requested());
  await settle();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].tabId, 42, 'the prompt appears in the agent\'s tab');
  assert.equal(asked[0].app, 'Email');
  assert.equal(asked[0].detail, 'Send a message to bob@example.com, subject "Lunch"');
  assert.ok(asked[0].timeoutMs < 60_000 && asked[0].timeoutMs > 50_000, 'ECHO closes the prompt before the gateway gives up');
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify({ method: 'plugin.approval.resolve', params: { id: 'plugin:abc', decision: 'allow-once' } }));
  assert.equal(JSON.stringify(logged), JSON.stringify([{ kind: 'message', detail: 'Send a message to bob@example.com, subject "Lunch"', outcome: 'approved' }]));
});

test('Deny, no answer in time, or a stop all answer Deny', async () => {
  for (const outcome of ['denied', 'timeout', 'stopped']) {
    const { approvals, calls } = approvalsHarness(outcome);
    approvals.handleEvent(requested());
    await settle();
    assert.equal(calls.at(-1).params.decision, 'deny', outcome);
  }
});

test('a request answered elsewhere takes ECHO\'s prompt down, without a second answer', async () => {
  let aborted = false;
  const { approvals, calls } = approvalsHarness(p => new Promise(resolve => {
    p.signal.addEventListener('abort', () => { aborted = true; resolve('stopped'); });
  }));
  approvals.handleEvent(requested());
  await settle();
  approvals.handleEvent({ event: 'plugin.approval.resolved', payload: { id: 'plugin:abc', decision: 'deny' } });
  await settle();
  assert.ok(aborted);
  assert.equal(calls.filter(c => c.method === 'plugin.approval.resolve').length, 0);
  assert.equal(approvals.pending(), 0);
});

test('only Echo guard\'s requests for ECHO\'s agents are shown, each once', async () => {
  const { approvals, asked } = approvalsHarness('approved');
  approvals.handleEvent(requested({ pluginId: 'other-plugin' }));
  approvals.handleEvent(requested({ agentId: 'main' }));
  await settle();
  assert.equal(asked.length, 0);
  const slow = approvalsHarness(() => new Promise(() => {}));
  slow.approvals.handleEvent(requested());
  slow.approvals.handleEvent(requested());
  await settle();
  assert.equal(slow.asked.length, 1, 'a repeated event does not open a second prompt');
});
