#!/usr/bin/env node
// Echo Mail: the email app ECHO's agents use through OpenClaw (an MCP server
// on stdio). It signs in to the user's mailbox with an app password (Gmail,
// iCloud, Yahoo…) over IMAP and SMTP. Search and read run freely; sending is
// paused by Echo guard until the user presses Allow in ECHO.
//
// The mailbox address and app password live in a file only the user can read
// (ECHO_MAIL_CONFIG, written by Echo Helper), never in OpenClaw's settings.
//
//   node echo-mail.mjs            serve MCP on stdin/stdout
//   node echo-mail.mjs --check    sign in once and report {"ok":true} or {"ok":false,"error":...}

import { readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = process.env.ECHO_MAIL_CONFIG || path.join(os.homedir(), '.openclaw-echo', 'echo-helper', 'apps', 'mail.json');
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const MAX_BODY = 20_000;
const MAX_TEXT = 8_000;

export function readConfig(file = CONFIG_FILE) {
  const c = JSON.parse(readFileSync(file, 'utf8'));
  if (!EMAIL.test(String(c.address || '')) || !c.password || !c.imap?.host || !c.smtp?.host) throw new Error('Email is not set up. Connect it again in ECHO\'s settings.');
  return c;
}

export const TOOLS = [
  { name: 'search_emails',
    description: 'Search the mailbox, newest first. Returns id, from, to, subject, date and whether it is unread. Use read_email for the text.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', description: 'Words to look for anywhere in the email.' },
      from: { type: 'string', description: 'Sender address or name.' },
      unread_only: { type: 'boolean' },
      folder: { type: 'string', enum: ['inbox', 'sent'], description: 'Default: inbox.' },
      limit: { type: 'number', description: '1 to 25, default 10.' } } } },
  { name: 'read_email',
    description: 'Read one email by the id search_emails returned.',
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: {
      id: { type: 'string' }, folder: { type: 'string', enum: ['inbox', 'sent'] } } } },
  { name: 'send_email',
    description: 'Send a new email from the user\'s address. The user is asked to allow it first.',
    inputSchema: { type: 'object', required: ['to', 'subject', 'body'], additionalProperties: false, properties: {
      to: { type: 'array', items: { type: 'string' }, description: 'Recipient addresses.' },
      cc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' }, body: { type: 'string', description: 'Plain text.' } } } },
  { name: 'reply_email',
    description: 'Reply to an email (by id) in the same conversation. Read it first, then copy its exact reply recipients into to/cc so the user can review them before allowing the send.',
    inputSchema: { type: 'object', required: ['id', 'body', 'to'], additionalProperties: false, properties: {
      id: { type: 'string' }, body: { type: 'string', description: 'Plain text.' }, reply_all: { type: 'boolean' },
      to: { type: 'array', items: { type: 'string' }, description: 'Expected reply recipient from read_email.' },
      cc: { type: 'array', items: { type: 'string' }, description: 'Expected Reply All recipients from read_email; empty for Reply.' } } } },
];

class ToolError extends Error {}

const addresses = (value, field) => {
  const list = (Array.isArray(value) ? value : value ? [value] : []).map(v => String(v).trim()).filter(Boolean);
  for (const a of list) if (!EMAIL.test(a)) throw new ToolError(`"${a}" in ${field} is not an email address.`);
  if (list.length > 20) throw new ToolError(`Too many addresses in ${field}.`);
  return list;
};
const who = list => (list || []).map(a => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
const normalizedAddresses = value => addresses(value, 'recipients').map(a => a.toLowerCase()).sort();
const sameAddresses = (a, b) => JSON.stringify(normalizedAddresses(a)) === JSON.stringify(normalizedAddresses(b));
const stripHtml = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

/**
 * The mail tools over a mailbox connection. `connect` opens IMAP (imapflow's
 * ImapFlow) and `transport` sends (nodemailer); tests pass fakes.
 */
export function createMailTools({ config, connect, transport }) {
  async function withMailbox(folder, work) {
    const client = await connect(config);
    try {
      let name = 'INBOX';
      if (folder === 'sent') {
        const boxes = await client.list();
        name = boxes.find(b => b.specialUse === '\\Sent')?.path || 'Sent';
      }
      const lock = await client.getMailboxLock(name);
      try { return await work(client); } finally { lock.release(); }
    } finally {
      await client.logout().catch(() => {});
    }
  }

  async function textOf(client, uid) {
    const msg = await client.fetchOne(uid, { envelope: true, bodyStructure: true, flags: true }, { uid: true });
    if (!msg) throw new ToolError(`No email with id ${uid}.`);
    const parts = [];
    (function walk(node) { if (!node) return; if (node.childNodes) node.childNodes.forEach(walk); else parts.push(node); })(msg.bodyStructure);
    const plain = parts.find(p => p.type === 'text/plain' && p.disposition !== 'attachment');
    const html = parts.find(p => p.type === 'text/html' && p.disposition !== 'attachment');
    let text = '';
    const part = plain || html;
    if (part) {
      const { content } = await client.download(uid, part.part || '1', { uid: true });
      const chunks = [];
      for await (const chunk of content) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > MAX_TEXT * 4) break; }
      text = Buffer.concat(chunks).toString('utf8');
      if (!plain) text = stripHtml(text);
    }
    return { msg, text: text.slice(0, MAX_TEXT) };
  }

  return {
    async search_emails(args = {}) {
      const limit = Math.min(25, Math.max(1, Math.floor(Number(args.limit) || 10)));
      return withMailbox(args.folder === 'sent' ? 'sent' : 'inbox', async client => {
        const criteria = {};
        if (args.query) criteria.text = String(args.query).slice(0, 200);
        if (args.from) criteria.from = String(args.from).slice(0, 200);
        if (args.unread_only) criteria.seen = false;
        const uids = (await client.search(Object.keys(criteria).length ? criteria : { all: true }, { uid: true })) || [];
        const newest = uids.sort((a, b) => b - a).slice(0, limit);
        const rows = [];
        if (newest.length) {
          for await (const m of client.fetch(newest, { envelope: true, flags: true }, { uid: true })) {
            rows.push({ id: String(m.uid), from: who(m.envelope?.from), to: who(m.envelope?.to), subject: m.envelope?.subject || '(no subject)',
              date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : '', unread: !m.flags?.has?.('\\Seen') });
          }
        }
        rows.sort((a, b) => Number(b.id) - Number(a.id));
        return rows.length ? rows : 'No emails match.';
      });
    },

    async read_email(args = {}) {
      const uid = String(args.id || '').trim();
      if (!/^\d+$/.test(uid)) throw new ToolError('id must be an id from search_emails.');
      return withMailbox(args.folder === 'sent' ? 'sent' : 'inbox', async client => {
        const { msg, text } = await textOf(client, uid);
        return { id: uid, from: who(msg.envelope?.from), to: who(msg.envelope?.to), cc: who(msg.envelope?.cc),
          subject: msg.envelope?.subject || '(no subject)', date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : '', text };
      });
    },

    async send_email(args = {}) {
      const to = addresses(args.to, 'to');
      const cc = addresses(args.cc, 'cc');
      if (!to.length) throw new ToolError('Say who to send it to.');
      const subject = String(args.subject || '').slice(0, 300);
      const body = String(args.body || '');
      if (!body.trim()) throw new ToolError('The email has no text.');
      if (body.length > MAX_BODY) throw new ToolError('The email is too long.');
      const info = await transport(config).sendMail({ from: config.address, to, cc: cc.length ? cc : undefined, subject, text: body });
      return `Sent to ${[...to, ...cc].join(', ')}${info?.messageId ? ` (message id ${info.messageId})` : ''}.`;
    },

    async reply_email(args = {}) {
      const uid = String(args.id || '').trim();
      if (!/^\d+$/.test(uid)) throw new ToolError('id must be an id from search_emails.');
      const body = String(args.body || '');
      if (!body.trim()) throw new ToolError('The reply has no text.');
      if (body.length > MAX_BODY) throw new ToolError('The reply is too long.');
      const original = await withMailbox('inbox', client => client.fetchOne(uid, { envelope: true }, { uid: true }));
      if (!original?.envelope) throw new ToolError(`No email with id ${uid}.`);
      const env = original.envelope;
      const me = config.address.toLowerCase();
      const replyTo = (env.replyTo?.length ? env.replyTo : env.from || []).map(a => a.address).filter(Boolean);
      const others = args.reply_all ? [...(env.to || []), ...(env.cc || [])].map(a => a.address).filter(a => a && a.toLowerCase() !== me) : [];
      const approvedTo = addresses(args.to, 'to');
      const approvedCc = addresses(args.cc, 'cc');
      if (!approvedTo.length || !sameAddresses(approvedTo, replyTo) || !sameAddresses(approvedCc, others)) {
        throw new ToolError('The reply recipients changed or were not reviewed. Read the email again and approve the exact recipients.');
      }
      const subject = /^re:/i.test(env.subject || '') ? env.subject : `Re: ${env.subject || ''}`;
      const info = await transport(config).sendMail({ from: config.address, to: replyTo, cc: others.length ? others : undefined, subject, text: body,
        ...(env.messageId ? { inReplyTo: env.messageId, references: [env.messageId] } : {}) });
      return `Replied to ${[...replyTo, ...others].join(', ')}${info?.messageId ? ` (message id ${info.messageId})` : ''}.`;
    },
  };
}

// --- the real mailbox (imapflow and nodemailer, installed next to this file) ------------

async function realConnectors() {
  const { ImapFlow } = await import('imapflow');
  const nodemailer = (await import('nodemailer')).default;
  return {
    connect: async c => {
      const client = new ImapFlow({ host: c.imap.host, port: c.imap.port || 993, secure: c.imap.secure !== false,
        auth: { user: c.address, pass: c.password }, logger: false });
      await client.connect();
      return client;
    },
    transport: c => nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port || 465, secure: c.smtp.secure !== false,
      auth: { user: c.address, pass: c.password } }),
  };
}

/** Sign in to both sides once: the check Echo Helper runs when the user connects email. */
export async function check(config) {
  const { connect, transport } = await realConnectors();
  const client = await connect(config);
  await client.logout().catch(() => {});
  await transport(config).verify();
  return { ok: true };
}

// --- MCP over stdio -----------------------------------------------------------------------

function serve() {
  const out = message => process.stdout.write(`${JSON.stringify(message)}\n`);
  const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });
  let tools = null;
  const toolsNow = async () => {
    if (!tools) tools = createMailTools({ config: readConfig(), ...(await realConnectors()) });
    return tools;
  };
  createInterface({ input: process.stdin }).on('line', async line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id === undefined) return;
    const reply = result => out({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') {
      reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo-mail', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (msg.method === 'ping') {
      reply({});
    } else if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      try {
        const impl = (await toolsNow())[name];
        if (!impl) throw new ToolError(`Unknown tool ${name}.`);
        reply(text(await impl(msg.params?.arguments || {})));
      } catch (error) {
        // Never echo the password or the server's full response.
        const why = error instanceof ToolError ? error.message
          : /auth|login|credential|535|534|password/i.test(String(error?.message)) ? 'The mailbox refused the sign-in. Connect email again in ECHO\'s settings with a new app password.'
          : `The mail server did not answer (${String(error?.code || error?.message || 'error').slice(0, 80)}).`;
        reply({ ...text(why), isError: true });
      }
    } else {
      out({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  });
}

// Started as a program (not imported by tests); compare real paths (macOS /var is /private/var).
const realPath = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realPath(fileURLToPath(import.meta.url)) === realPath(process.argv[1])) {
  if (process.argv.includes('--check')) {
    check(readConfig()).then(r => console.log(JSON.stringify(r)), error => {
      console.log(JSON.stringify({ ok: false, error: /auth|login|535|534|password|credential/i.test(String(error?.message))
        ? 'The mailbox refused the sign-in. Check the address and the app password.' : `Could not reach the mail server (${String(error?.code || error?.message).slice(0, 80)}).` }));
      process.exitCode = 1;
    });
  } else {
    serve();
  }
}
