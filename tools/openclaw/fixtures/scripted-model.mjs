#!/usr/bin/env node
// A scripted stand-in for an AI model, for tests that must not spend a real
// model's quota. It speaks the OpenAI chat-completions API (plain and
// streaming), so OpenClaw can use it as a local provider.
//
// A user message "CALL <tool> <json args>" makes it call that tool (when the
// tool is offered); once the tool's result comes back it replies
// "DONE: <result>". Any other message gets "OK: <message>".
//
//   node scripted-model.mjs [port]      (prints "listening <port>")

import fs from 'node:fs';
import http from 'node:http';

const port = Number(process.argv[2] || 0);
let calls = 0;

const lastUser = messages => [...messages].reverse().find(m => m.role === 'user');
const textOf = content => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(p => p.text || '').join('') : '');

/** What the model says next: a tool call, or text. */
function next(body) {
  const messages = body.messages || [];
  const last = messages[messages.length - 1];
  if (last?.role === 'tool') return { text: `DONE: ${textOf(last.content).slice(0, 400)}` };
  // This turn's user messages: OpenClaw adds its own context messages after the person's.
  const turnStart = messages.map(x => x.role).lastIndexOf('assistant') + 1;
  const turn = messages.slice(turnStart).filter(x => x.role === 'user').map(x => textOf(x.content));
  const said = (turn.find(t => /CALL\s/.test(t)) || textOf(lastUser(messages)?.content)).trim();
  const m = said.match(/CALL\s+([A-Za-z0-9_-]+)[ \t]*(\{.*\})?/);
  if (m) {
    const offered = (body.tools || []).map(t => t.function?.name);
    if (!offered.includes(m[1])) return { text: `NO TOOL ${m[1]} (offered: ${offered.filter(Boolean).join(', ')})` };
    return { tool: { id: `call_${++calls}`, name: m[1], arguments: m[2] || '{}' } };
  }
  return { text: `OK: ${said.slice(0, 200)}` };
}

function completion(body, out) {
  const message = out.tool
    ? { role: 'assistant', content: null, tool_calls: [{ id: out.tool.id, type: 'function', function: { name: out.tool.name, arguments: out.tool.arguments } }] }
    : { role: 'assistant', content: out.text };
  return { id: `chatcmpl-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message, finish_reason: out.tool ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
}

function stream(res, body, out) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const base = { id: `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model };
  const send = choice => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, ...choice }] })}\n\n`);
  send({ delta: { role: 'assistant' } });
  if (out.tool) {
    send({ delta: { tool_calls: [{ index: 0, id: out.tool.id, type: 'function', function: { name: out.tool.name, arguments: out.tool.arguments } }] } });
    send({ delta: {}, finish_reason: 'tool_calls' });
  } else {
    send({ delta: { content: out.text } });
    send({ delta: {}, finish_reason: 'stop' });
  }
  res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  res.end('data: [DONE]\n\n');
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'script', object: 'model', owned_by: 'test' }] }));
    return;
  }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.statusCode = 404; res.end(); return; }
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { res.statusCode = 400; res.end(); return; }
    if (process.env.SCRIPTED_MODEL_DUMP) fs.writeFileSync(process.env.SCRIPTED_MODEL_DUMP, JSON.stringify(body, null, 1));
    const out = next(body);
    if (body.stream) { stream(res, body, out); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(completion(body, out)));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
