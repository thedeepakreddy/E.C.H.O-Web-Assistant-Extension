const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Echo GitHub, the GitHub app agents use: a bridge to GitHub's remote MCP
// server that signs in as the user and lets agents read and talk in issues,
// never push, merge or delete. A fake GitHub stands in for the network.

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src/helper/echo-github.mjs')).href);

function fakeGitHub({ sse = false } = {}) {
  const seen = [];
  const tools = ['get_me', 'list_issues', 'issue_read', 'issue_write', 'add_issue_comment', 'search_code',
    'push_files', 'merge_pull_request', 'delete_file', 'create_or_update_file', 'create_repository'].map(name => ({ name, inputSchema: { type: 'object' } }));
  const fetchImpl = async (url, init) => {
    const msg = JSON.parse(init.body);
    seen.push({ method: msg.method, auth: init.headers.authorization, session: init.headers['mcp-session-id'] });
    const headers = new Map([['content-type', sse ? 'text/event-stream' : 'application/json']]);
    if (msg.method === 'initialize') headers.set('mcp-session-id', 'sess-1');
    if (msg.id === undefined) return { status: 202, ok: true, headers: { get: k => headers.get(k) }, text: async () => '' };
    const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : msg.method === 'tools/list' ? { tools }
      : { content: [{ type: 'text', text: `ran ${msg.params.name}` }] };
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    const text = sse ? `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ${body}\n\n` : body;
    return { status: 200, ok: true, headers: { get: k => headers.get(k) }, text: async () => text };
  };
  return { fetchImpl, seen };
}

test('github: agents see reading and issue tools only; pushing, merging and deleting are left out', async () => {
  const { createBridge, createRemote } = await load();
  const gh = fakeGitHub();
  const bridge = createBridge(createRemote({ getToken: async () => 'gho_testtoken0000000000', fetchImpl: gh.fetchImpl, url: 'https://github.test/mcp/' }));
  const list = await bridge.handle({ id: 1, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(t => t.name), ['get_me', 'list_issues', 'issue_read', 'issue_write', 'add_issue_comment', 'search_code']);
  const refused = await bridge.handle({ id: 2, method: 'tools/call', params: { name: 'push_files', arguments: {} } });
  assert.equal(refused.result.isError, true);
  assert.ok(!gh.seen.some(s => s.method === 'tools/call'), 'a refused tool never reaches GitHub');
  const close = await bridge.handle({ id: 4, method: 'tools/call', params: { name: 'issue_write', arguments: { method: 'close' } } });
  assert.equal(close.result.isError, true);
  assert.ok(!gh.seen.some(s => s.method === 'tools/call'), 'a generic write cannot close or edit an issue');
  const create = await bridge.handle({ id: 5, method: 'tools/call', params: { name: 'issue_write', arguments: { method: 'create' } } });
  assert.equal(create.result.content[0].text, 'ran issue_write');
  const ran = await bridge.handle({ id: 3, method: 'tools/call', params: { name: 'list_issues', arguments: {} } });
  assert.equal(ran.result.content[0].text, 'ran list_issues');
  assert.equal(gh.seen.find(s => s.method === 'tools/call').session, 'sess-1', 'the session from initialize is kept');
  assert.ok(gh.seen.every(s => s.auth === 'Bearer gho_testtoken0000000000'), 'signed in as the user');
});

test('github: answers that come as an event stream are read too', async () => {
  const { createBridge, createRemote } = await load();
  const gh = fakeGitHub({ sse: true });
  const bridge = createBridge(createRemote({ getToken: async () => 'gho_testtoken0000000000', fetchImpl: gh.fetchImpl, url: 'https://github.test/mcp/' }));
  const ran = await bridge.handle({ id: 9, method: 'tools/call', params: { name: 'get_me', arguments: {} } });
  assert.equal(ran.result.content[0].text, 'ran get_me');
});

test('github: connecting checks the token with GitHub', async () => {
  const { check } = await load();
  const ok = await check({ getToken: async () => 'gho_testtoken0000000000', fetchImpl: async () => ({ ok: true, json: async () => ({ login: 'octocat' }) }) });
  assert.deepEqual(ok, { ok: true, login: 'octocat' });
  const bad = await check({ getToken: async () => 'gho_testtoken0000000000', fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(bad.ok, false);
});
