#!/usr/bin/env node
// "Watch me", end to end, the way a person does it: open the Echo panel (long
// press on the avatar), press Watch me, fill in a form, press Done on the
// recording bar, name the task, then do it again from "Your tasks" on a fresh
// page. No model is used: a saved task replays the user's own steps.
//
//   npm run build && node tools/e2e/watch-me.cjs
// With --agent, the page changes before the second run so a step no longer
// fits, and an agent finishes it (needs agent mode on; see
// tools/openclaw/turn-on-e2e.cjs, and a model with quota).

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchEcho, evaluate, findTarget, delay } = require('./chrome.cjs');

const FIXTURES = path.join(__dirname, '../echobench/fixtures');
const AGENT = process.argv.includes('--agent');
// With --agent, the site is redesigned after recording: the form now sits behind
// a new "Start your request" button and its name field is renamed. Replaying the
// recording stops at the first step, and the agent has to finish the task.
let redesigned = false;
const redesign = html => html
  .replace('<label>Full name <input id="name" name="name" autocomplete="name"></label>',
    '<label>Your full name <input id="fullname" name="fullname" autocomplete="off"></label>')
  .replace('<form id="f"', '<button id="start" onclick="this.remove(); document.getElementById(\'f\').hidden = false;">Start your request</button><form id="f" hidden');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`); };

async function waitFor(fn, timeoutMs, stepMs = 250) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await delay(stepMs)) {
    const value = await fn().catch(() => null);
    if (value) return value;
  }
  return null;
}

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, path.basename(req.url.split('?')[0]));
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'text/html');
    const html = fs.readFileSync(file, 'utf8');
    res.end(redesigned && file.endsWith('form.html') ? redesign(html) : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/form.html`;
  const { cdp, extensionId, worker, userDir, cleanup } = await launchEcho({ urls: [url] });
  process.on('exit', () => { cleanup(); server.close(); });
  const inWorker = expr => evaluate(cdp, worker.targetId, expr);
  const target = await findTarget(cdp, t => t.type === 'page' && t.url.includes('form.html'));
  const page = expr => evaluate(cdp, target.targetId, expr);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });

  const tab = await inWorker(`chrome.tabs.query({}).then(t => t.find(x => x.url.includes('form.html')).id)`);
  // Wake ECHO as its toolbar button does, from one of its own pages.
  const { targetId: panelId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html`, background: true });
  await findTarget(cdp, t => t.targetId === panelId);
  await delay(800);
  await evaluate(cdp, panelId, `chrome.runtime.sendMessage({ type: 'WAKE_ECHO_REQUEST' })`);
  await cdp.send('Target.activateTarget', { targetId: target.targetId });
  const wake = async () => {
    await waitFor(() => page(`!!document.querySelector('#echo-root-wrapper')`), 15_000);
  };
  const centerOf = selector => page(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const click = async ({ x, y }) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const typeText = text => send('Input.insertText', { text });
  const pressEnter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const openPanel = async () => {
    if (await page(`document.querySelector('#echo-chat-box')?.classList.contains('visible')`)) return true;
    const c = await centerOf('#echo-root-wrapper');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await delay(900);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    return waitFor(() => page(`document.querySelector('#echo-chat-box')?.classList.contains('visible')`), 3_000);
  };
  const buttonIn = (selector, text) => page(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.innerText.includes(${JSON.stringify(text)}));
    const r = b?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  // The recording bar is in a closed shadow root: DevTools can still see it.
  const bar = async () => {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
    const host = (function find(n) { if (n.attributes?.includes('echo-rec-bar')) return n; for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) { const f = find(c); if (f) return f; } return null; })(root);
    if (!host) return null;
    const nodes = [];
    (function walk(n) { nodes.push(n); for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); })(host);
    const text = nodes.filter(n => n.nodeType === 3 && n.parentId && !nodes.find(p => p.nodeId === n.parentId && p.nodeName === 'STYLE')).map(n => n.nodeValue).join(' ');
    const button = async label => {
      const b = nodes.find(n => n.nodeName === 'BUTTON' && (n.children || []).some(c => c.nodeValue === label));
      if (!b) return null;
      const { model } = await send('DOM.getBoxModel', { nodeId: b.nodeId });
      const q = model.content;
      return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
    };
    return { text, button };
  };
  const said = [];
  const listen = setInterval(async () => {
    const t = await page(`document.querySelector('#echo-log-box')?.innerText || ''`).catch(() => '');
    if (t && said.at(-1) !== t) said.push(t);
  }, 200);

  // 1. Echo panel → Watch me: the recording bar appears.
  await wake();
  check('a long press on the avatar opens the Echo panel', await openPanel());
  await click(await buttonIn('#echo-chat-box .cmd-chip', 'Watch me'));
  const watching = await waitFor(async () => { const b = await bar(); return b && /watching/i.test(b.text) && b; }, 5_000);
  check('Watch me starts recording and shows the recording bar', !!watching, watching?.text);

  // 2. The person does the task.
  await click(await centerOf('#name')); await typeText('Ada Lovelace');
  await click(await centerOf('#email')); await typeText('ada@example.com');
  await click(await centerOf('button[type=submit]'));
  const counted = await waitFor(async () => { const b = await bar(); return b && /\b5 steps\b/.test(b.text) && b.text; }, 5_000);
  check('the bar counts the steps', !!counted, counted || (await bar())?.text);

  // 3. Done → name it → Save (Enter).
  await click(await (await bar()).button('Done'));
  const naming = await waitFor(async () => { const b = await bar(); return b && /Name it/.test(b.text); }, 3_000);
  check('Done asks for a name, with one suggested', !!naming);
  await typeText('Callback');   // replaces the selected suggestion
  await pressEnter();
  const saved = await waitFor(async () => { const b = await bar(); return b && /Saved "Callback"/.test(b.text) && b.text; }, 5_000);
  check('the task is saved and the bar says so', !!saved, saved);
  const stored = await inWorker(`chrome.storage.local.get('echo_workflows').then(r => r.echo_workflows?.Callback?.steps.map(s => s.type + (s.label ? ':' + s.label : '')))`);
  check('it saved exactly what the person did, nothing from ECHO\'s own controls',
    JSON.stringify(stored) === JSON.stringify(['click:name', 'type:name', 'click:email', 'type:email', 'click:Request callback']), JSON.stringify(stored));

  if (AGENT) {
    const { keepGatewayTidy, turnOnAgentMode } = require('../openclaw/agent-mode-live.cjs');
    process.on('exit', keepGatewayTidy());
    const status = await turnOnAgentMode({ cdp, panelId, userDir }).catch(error => ({ error: error.message }));
    check('agent mode is on', !!status?.ready, status?.error || `OpenClaw ${status?.serverVersion}`);
    redesigned = true;
  }

  // 4. A fresh page: do it again from "Your tasks".
  await page(`location.reload(); true`);
  await delay(1500);
  await wake();
  await openPanel();
  const chip = await waitFor(() => buttonIn('#echo-chat-box .cmd-task', 'Callback'), 5_000);
  check('the Echo panel lists it under Your tasks', !!chip);
  await click(chip);
  if (AGENT) {
    const started = Date.now();
    const done = await waitFor(() => page(`window.__submitted === true && document.querySelector('#fullname').value + ' / ' + document.querySelector('#email').value`), 300_000, 1000);
    check('the page changed, and the agent finished the task: form filled and sent', done === 'Ada Lovelace / ada@example.com', `${done} · ${Math.round((Date.now() - started) / 1000)}s`);
    const agents = (await evaluate(cdp, panelId, `chrome.runtime.sendMessage({ type: 'ECHO_AGENT_LIST' })`))?.agents || [];
    const worker = agents.find(a => a.tabId === tab);
    check('an agent was given the tab to do it', !!worker, worker?.agent);
    const thread = async () => (await evaluate(cdp, panelId, `chrome.runtime.sendMessage({ type: 'ECHO_AGENT_THREAD', agent: ${JSON.stringify(worker?.agent)} })`))?.messages || [];
    // After ECHO's note that the page changed, the agent's own report.
    const last = await waitFor(async () => (await thread()).filter(m => m.role === 'echo' && !/^This page changed/.test(m.text)).at(-1)?.text, 120_000, 1000);
    check('the agent reports back in its thread', !!last, last);
    console.log('      thread:', (await thread()).map(m => `${m.role}: ${m.text}`).join('\n              '));
  } else {
    const done = await waitFor(() => page(`window.__submitted === true && document.querySelector('#name').value`), 20_000);
    check('pressing it does the task again: form filled and sent', done === 'Ada Lovelace', done);
    const reply = await waitFor(async () => said.find(t => /all 5 steps/.test(t)), 5_000);
    check('ECHO says it is done', !!reply, reply || said.join(' | '));
  }

  // 5. A command typed while ECHO is still talking is not dropped.
  await openPanel();
  await click(await centerOf('#echo-chat-box input'));
  await typeText('list my workflows');
  await pressEnter();
  const listed = await waitFor(async () => said.find(t => /Saved workflows/.test(t)), 8_000);
  check('ECHO answers a command sent while it was speaking', !!listed, said.slice(-2).join(' | '));

  clearInterval(listen);
  cdp.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.error('\nWatch me e2e failed:', error.stack || error.message); process.exit(1); });
