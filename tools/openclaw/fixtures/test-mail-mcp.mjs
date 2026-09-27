#!/usr/bin/env node
// A stand-in mail app for tests: an MCP server (stdio) with the same kind of
// tools a real mail server offers. Nothing leaves this computer: "sent" mail is
// appended to the file named by TEST_MAIL_LOG, one JSON object per line.

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const LOG = process.env.TEST_MAIL_LOG || '/dev/null';
const INBOX = [
  { id: 'm1', from: 'ada@example.com', subject: 'Lunch on Friday?', snippet: 'Are you free for lunch on Friday at noon?' },
  { id: 'm2', from: 'billing@example.com', subject: 'Your invoice #1042', snippet: 'Your invoice for September is ready.' },
];

const TOOLS = [
  { name: 'search_emails', description: 'Search the mailbox. Returns id, sender, subject and a short snippet for each match.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false } },
  { name: 'read_email', description: 'Read one email by id.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false } },
  { name: 'send_email', description: 'Send an email.',
    inputSchema: { type: 'object', required: ['to', 'subject', 'body'], additionalProperties: false,
      properties: { to: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' } } } },
];

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

function call(name, args = {}) {
  if (name === 'search_emails') {
    const q = String(args.query || '').toLowerCase();
    return text(INBOX.filter(m => !q || JSON.stringify(m).toLowerCase().includes(q)));
  }
  if (name === 'read_email') {
    const m = INBOX.find(x => x.id === args.id);
    return m ? text({ ...m, body: m.snippet }) : { ...text(`No email with id ${args.id}.`), isError: true };
  }
  if (name === 'send_email') {
    const to = Array.isArray(args.to) ? args.to : [args.to];
    appendFileSync(LOG, `${JSON.stringify({ to, subject: args.subject, body: args.body, at: Date.now() })}\n`);
    return text(`Sent to ${to.join(', ')}.`);
  }
  return { ...text(`Unknown tool ${name}.`), isError: true };
}

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;   // notifications
  if (msg.method === 'initialize') {
    reply(msg.id, { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} },
      serverInfo: { name: 'test-mail', version: '1.0.0' } });
  } else if (msg.method === 'tools/list') {
    reply(msg.id, { tools: TOOLS });
  } else if (msg.method === 'tools/call') {
    reply(msg.id, call(msg.params?.name, msg.params?.arguments));
  } else if (msg.method === 'ping') {
    reply(msg.id, {});
  } else {
    fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
});
