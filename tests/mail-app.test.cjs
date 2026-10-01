const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// Echo Mail, the email app agents use: search and read the mailbox, send and
// reply from the user's own address. A fake mailbox stands in for IMAP and SMTP.

const SERVER = path.join(__dirname, '..', 'src/helper/echo-mail.mjs');
const load = () => import(pathToFileURL(SERVER).href);
const config = { address: 'me@example.com', password: 'app-password-not-real', imap: { host: 'imap.example.com' }, smtp: { host: 'smtp.example.com' } };

function fakeMailbox() {
  const messages = [
    { uid: 7, flags: new Set(['\\Seen']), text: 'Are you free for lunch on Friday?',
      envelope: { subject: 'Lunch', date: '2026-09-20T10:00:00Z', messageId: '<m7@example.com>', from: [{ name: 'Ada', address: 'ada@example.com' }],
        to: [{ address: 'me@example.com' }], cc: [{ address: 'bob@example.com' }] },
      bodyStructure: { childNodes: [{ type: 'text/plain', part: '1' }, { type: 'text/html', part: '2' }] } },
    { uid: 9, flags: new Set(), text: '<p>Your <b>invoice</b> is ready</p>',
      envelope: { subject: 'Invoice', date: '2026-09-21T10:00:00Z', from: [{ address: 'billing@example.com' }], to: [{ address: 'me@example.com' }] },
      bodyStructure: { type: 'text/html', part: '1' } },
  ];
  const opened = [];
  const sent = [];
  const client = {
    list: async () => [{ path: 'INBOX' }, { path: '[Gmail]/Sent Mail', specialUse: '\\Sent' }],
    getMailboxLock: async name => { opened.push(name); return { release() {} }; },
    search: async criteria => messages.filter(m => (!criteria.text || JSON.stringify(m).toLowerCase().includes(criteria.text.toLowerCase()))
      && (criteria.seen !== false || !m.flags.has('\\Seen'))).map(m => m.uid),
    fetch: async function* (uids) { for (const m of messages.filter(x => uids.includes(x.uid))) yield m; },
    fetchOne: async uid => messages.find(m => String(m.uid) === String(uid)),
    download: async uid => ({ content: (async function* () { yield Buffer.from(messages.find(m => String(m.uid) === String(uid)).text); })() }),
    logout: async () => {},
  };
  return { messages, opened, sent, connect: async () => client, transport: () => ({ sendMail: async mail => { sent.push(mail); return { messageId: '<new@example.com>' }; } }) };
}

test('mail: search lists newest first and reads the text, plain or from HTML', async () => {
  const { createMailTools } = await load();
  const box = fakeMailbox();
  const mail = createMailTools({ config, connect: box.connect, transport: box.transport });
  const rows = await mail.search_emails({});
  assert.deepEqual(rows.map(r => r.id), ['9', '7']);
  assert.equal(rows[0].unread, true);
  assert.equal(rows[1].from, 'Ada <ada@example.com>');
  assert.deepEqual((await mail.search_emails({ unread_only: true })).map(r => r.id), ['9']);
  assert.equal((await mail.read_email({ id: '7' })).text, 'Are you free for lunch on Friday?');
  assert.equal((await mail.read_email({ id: '9' })).text, 'Your invoice is ready');
  await mail.search_emails({ folder: 'sent' });
  assert.equal(box.opened.at(-1), '[Gmail]/Sent Mail', 'the Sent folder is found by its special use');
});

test('mail: send and reply go from the user\'s address, with the conversation kept', async () => {
  const { createMailTools } = await load();
  const box = fakeMailbox();
  const mail = createMailTools({ config, connect: box.connect, transport: box.transport });
  assert.match(await mail.send_email({ to: ['bob@example.com'], subject: 'Hi', body: 'Hello Bob' }), /^Sent to bob@example\.com/);
  assert.deepEqual({ ...box.sent[0] }, { from: 'me@example.com', to: ['bob@example.com'], cc: undefined, subject: 'Hi', text: 'Hello Bob' });
  assert.match(await mail.reply_email({ id: '7', body: 'Yes!', reply_all: true, to: ['ada@example.com'], cc: ['bob@example.com'] }), /^Replied to ada@example\.com, bob@example\.com/);
  assert.equal(box.sent[1].subject, 'Re: Lunch');
  assert.equal(box.sent[1].inReplyTo, '<m7@example.com>');
  assert.deepEqual(box.sent[1].cc, ['bob@example.com'], 'reply-all leaves the user out');
});

test('mail: bad requests are refused before anything is sent', async () => {
  const { createMailTools } = await load();
  const box = fakeMailbox();
  const mail = createMailTools({ config, connect: box.connect, transport: box.transport });
  await assert.rejects(mail.send_email({ to: ['not an address'], subject: 'x', body: 'y' }), /not an email address/);
  await assert.rejects(mail.send_email({ to: [], subject: 'x', body: 'y' }), /who to send it to/);
  await assert.rejects(mail.send_email({ to: ['bob@example.com'], subject: 'x', body: '  ' }), /no text/);
  await assert.rejects(mail.read_email({ id: '../../etc' }), /id must be/);
  await assert.rejects(mail.reply_email({ id: '7', body: 'Yes!', reply_all: true, to: ['ada@example.com'], cc: [] }), /recipients changed/);
  assert.equal(box.sent.length, 0);
});

test('mail: speaks MCP on stdio, and a sign-in problem never shows the password', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-mail-test-'));
  const file = path.join(dir, 'mail.json');
  fs.writeFileSync(file, JSON.stringify({ ...config, imap: { host: '127.0.0.1', port: 1, secure: false }, smtp: { host: '127.0.0.1', port: 1, secure: false } }));
  const replies = await new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ECHO_MAIL_CONFIG: file } });
    let out = '';
    child.stdout.on('data', c => { out += c; if (out.split('\n').filter(Boolean).length >= 3) child.kill(); });
    child.on('exit', () => resolve(out.split('\n').filter(Boolean).map(l => JSON.parse(l))));
    for (const m of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_emails', arguments: {} } }]) child.stdin.write(`${JSON.stringify(m)}\n`);
  });
  const byId = Object.fromEntries(replies.map(r => [r.id, r]));
  assert.equal(byId[1].result.serverInfo.name, 'echo-mail');
  assert.deepEqual(byId[2].result.tools.map(t => t.name), ['search_emails', 'read_email', 'send_email', 'reply_email']);
  assert.equal(byId[3].result.isError, true);
  assert.doesNotMatch(JSON.stringify(byId[3]), /app-password-not-real/);
});
