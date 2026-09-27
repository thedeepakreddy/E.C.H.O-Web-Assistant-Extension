# ECHO × OpenClaw — local gateway and checks

ECHO connects to its own OpenClaw gateway profile (`echo`), separate from any
other OpenClaw setup on the machine. Each of the eight avatars is an OpenClaw
agent (`echo`, `echo-style`, `echo-officer`, `echo-patrol`, `echo-mentor`,
`echo-visionary`, `echo-analyst`, `echo-core`) that may use only its own
browser tools, in the tab it is assigned. The extension side lives in
`src/background/openclaw/` and stays off until agent mode is turned on.

## Turning agent mode on

Agents (named **Assign Agent** in the side panel) run on OpenClaw only while
agent mode is on; otherwise they use ECHO's built-in brain. There is one
**Turn on** button, in three places: the Assign Agent sheet in the side
panel, the Echo panel on the page (long-press the avatar: **Turn on agents**),
and the **Agent mode** group on the settings page.

- **The first time**, ECHO needs Echo Helper (`src/helper/echo-helper.mjs`),
  a small Chrome native-messaging program (`com.echo.helper`): Chrome never
  lets an extension install or start programs. ECHO shows a one-line command
  to paste in Terminal. It installs OpenClaw 2026.9.6 with npm if it is
  missing, puts the helper in `~/.openclaw-echo/echo-helper/`, and registers
  it for this extension id only (`allowed_origins`) in each Chromium browser
  found. ECHO notices the helper by itself and carries on.
- **Turn on** asks the helper to configure the `echo` profile (loopback
  only, a token ECHO made, the calling extension as the only allowed origin,
  no LAN advertising or heartbeats), declare every agent's commands, create
  the eight agents with their own tools only (no shell, files, OpenClaw's
  browser, skills or code mode), write each agent's `AGENTS.md`, `SOUL.md` and
  `IDENTITY.md`, start the gateway as a background service, and approve
  exactly this ECHO's device. The helper accepts only checked data: fixed
  config keys, hex tokens and device ids, known agent ids, tool names and
  workspace files. Progress shows in plain words; it takes about a minute.
- **An AI**: if OpenClaw has no model yet, ECHO uses the Gemini or Claude
  key already saved in ECHO, or asks for one. The key goes to OpenClaw on
  stdin (`models auth paste-api-key`), never on a command line.
- **Turn off** stops and disables the gateway service and stops ECHO from
  connecting.

ECHO deletes the shared token once both connections are paired, and uses its
device tokens from then on. ECHOs already paired stay paired when the profile
is set up again.

**Running OpenClaw yourself:** under Advanced, set the address and paste the
gateway token (`openclaw --profile echo gateway auth-token --show`), or copy
the full setup command, which does everything Turn on does from Terminal
(`npm run openclaw:setup-e2e` checks it).

## How a request flows

Only avatars run on OpenClaw: the classic ECHO chat always uses the built-in
brain, and its side panel says so (with a shortcut to give the tab to an
avatar) once OpenClaw is Ready. An avatar's thread shows "on OpenClaw" or
"built-in brain" under its name.

A message to an avatar (side panel thread, or the orb in its tab) first tries
ECHO's local skills (stop, workflows, extractors: instant and free). Otherwise
it becomes a run in the avatar's session, `agent:<agentId>:lease-<leaseId>`
(one per tab assignment). ECHO offers the gateway only the tools of avatars
that have a tab in this browser, and a run starts once its avatar's tools are
on offer. Progress ("Using observe…") comes from gateway
events; the reply comes from `agent.wait`, so it arrives even if events were
missed while ECHO reconnected, and runs in flight survive a worker restart.
Stopping an avatar aborts its run on the gateway. Paying and sending still ask
the user, within the tool call's 30 s deadline.

## Apps for agents, and asking before sending (Phase 4)

Agents can use connected apps: **Email** (Gmail, iCloud, Yahoo or any
IMAP/SMTP mailbox, with an app password) and **GitHub** (the GitHub CLI's
login, or a token). Connect them in Settings → Apps for agents, and choose
which agents may use each one; an agent not given an app never sees its tools
(`tools.allow` gets `echo-mail__*` / `echo-github__*` per agent).

- Both apps are MCP servers ECHO ships and Echo Helper installs next to itself
  (`src/helper/echo-mail.mjs`, with imapflow and nodemailer pinned;
  `src/helper/echo-github.mjs`, a bridge to GitHub's remote MCP server).
  Credentials go straight from the settings page to the helper, into files only
  the user can read (`~/.openclaw-echo/echo-helper/apps/`); they are never in
  OpenClaw's settings, on a command line, or kept by ECHO. Connecting signs in
  once to check.
- GitHub agents can read, open issues and comment; the bridge leaves out
  everything that pushes, merges or deletes.
- **Approvals.** Echo guard (`src/helper/echo-guard.mjs`), an OpenClaw plugin,
  pauses an ECHO agent's app call that sends a message or pays (the same rule
  as the browser: send, reply, forward, post, comment, create an issue; pay,
  buy, order). OpenClaw asks every approval client; ECHO is one (operator
  scope `operator.approvals`, cap `plugin-approvals`) and shows its usual
  Allow once / Deny in the agent's tab and the chat panel, answering before
  the gateway's deadline. No answer, a stop, or no ECHO to ask all mean the
  call is blocked. Reading, drafting and other changes run and are logged.
- ECHO gets `operator.approvals` when it connects with the gateway's key
  (Turn on). An ECHO paired earlier keeps working without it, and the Apps
  section says to Turn on again, until then every app send is blocked.

## Tasks the user shows ECHO ("Watch me")

**Watch me** in the Echo panel records the user's clicks, typing and choices on
the page (never passwords, card or sign-in fields, and never ECHO's own
controls). A bar at the top of the page counts the steps; **Done** asks for a
name and saves the task. Saved tasks are listed under **Your tasks** in the Echo
panel. Pressing one replays the user's own steps first: no model, no tokens.
If a step no longer fits the page (the site changed) and agent mode is on, an
agent is given the tab (the character on the page if it is free), told which
step stopped, and finishes: it does that step itself with `act` and runs the
rest with the `workflow` tool from the next step. A request that changes a task
("do Callback for Bob") is not a plain replay: it goes to the agent, which can
`show` the steps and do them with the new values.

## What an avatar sees and does

- **observe** gives the page as lines of text and controls in reading order,
  the whole page (shadow DOM, tables, cards), without hidden text. Each
  control has a reference like `[e12]` that stays the same while it is on the
  page; looking again returns only what changed. Field values are never shown
  (a field is `empty`, `filled` or `protected`).
- **act** runs up to ten steps by reference (click, type, select, check,
  press, scroll) and answers with what changed. A reference to a control that
  was replaced, or from before a page load the avatar did not see, fails with
  "observe again" instead of acting on another element.
- **extract** returns data exactly as written (`list` for products and
  results, tables, prices, emails…); **verify** checks the URL, exact quotes
  on the whole page and field states, with proof.
- **screenshot** works only while the avatar's tab is on screen (it never
  brings a tab forward), as a small JPEG.
- **workflow** replays the user's recordings; a run that stops at a step says
  which, and can continue from the next step after the avatar did it by hand.
  **watch** creates watchers; when one fires, its avatar is woken in its tab.
- **navigate** and **tabs open** go only to addresses the avatar has seen (on
  a page it read, or in what the user said), a site's home page, or a web
  search: a guessed deep link could land on some other page and answer from
  it. Links on the page are opened by reference; a link that opens a new tab
  is opened by ECHO (Chrome would block it as a pop-up) and joins the avatar's
  tabs.
- Paying and sending ask once. Going to a checkout page does not ask; the
  payment click there does. A denied action is not asked about again in the
  same task, and the avatar is told whether the user denied it or did not
  answer in time.
- Tool results reach the model as plain text. A tool that cannot do something
  answers "Not done: …" with the reason, as a result the model always reads.

Everything the tools return is kept as evidence for the conversation. Each
reply's checkable facts (prices, figures with units, years, dates, emails,
links, quoted phrases) are looked up in it, and any not found appear under the
reply as **Unverified**. The same check runs for the classic ECHO's replies.
Replies stream into the avatar's thread as they are written.

## Checks

| Command | What it proves |
| --- | --- |
| `npm test` | tool host, session manager (duplicate and missed events, stop, resume), browser tools (own tabs only, batched steps), approval deadlines, registry and setup script, Echo Helper (checked data, app credentials), Echo guard's send/pay rule, ECHO's app approvals, the email and GitHub apps |
| `npm run openclaw:probe` | origin + device signature accepted, pairing, per-avatar tool isolation, tool round trip (no model) |
| `npm run openclaw:e2e -- --approve [--agent-run]` | the built extension: pairing, reading a real tab, isolation, idle survival, worker-restart recovery |
| `npm run openclaw:agents-e2e` | Phase 2, real model turns: setup script, pairing and token removal, eight agents isolated, two avatars in parallel, payment approval, stop, gateway-down fallback and reconnect |
| `npm run openclaw:turn-on-e2e` | the Turn on button as a person uses it: one-time helper install from the copied command (run with a temp `HOME`), ECHO carrying on by itself to ready, the Echo panel's buttons, Turn off, and Turn on again from the Echo panel (restarts the gateway service; leaves it running) |
| `npm run e2e:watch-me` | "Watch me" with no model: Watch me in the Echo panel, the recording bar (step count, Done, name, Save), nothing from ECHO's own controls recorded, the task under Your tasks, doing it again on a fresh page, a command typed while ECHO speaks |
| `npm run openclaw:watch-me-e2e` | the same, then the site is redesigned (a new Start button, a renamed field): the replay stops at step 1, an agent gets the tab, finishes the task and reports back (turns agent mode on as the Turn on test does; a few model calls) |
| `npm run openclaw:approvals-e2e` | Phase 4 with a throwaway gateway, a test mail app and a scripted model (no account, no quota): an agent's send waits for Allow in ECHO's chat panel, Allow sends, Deny blocks and the agent is told, reading runs without asking, an agent not given the app never sees it |
| `npm run openclaw:stale-token-e2e` | a device token rotated on the gateway is forgotten and ECHO gets back in with the gateway's key (no browser) |
| `npm run openclaw:harness-e2e` | Phase 3, no model: the avatar tools exactly as a model receives them (references, changes only, stale references refused, select/check/type, payment fields refused, list extraction, quote and field checks, screenshots) |
| `npm run bench -- --openclaw` | EchoBench with the avatars on the gateway's model; tokens per task from the gateway's session records |
| `node tools/openclaw/agent-reconnect.cjs` | real model turns keep calling ECHO's tools after the operator connection is replaced |

The probe and e2e keep a test identity in `tools/openclaw/.probe-state/`
(gitignored), and approve only on the local test gateway. The e2e tests
remove the throwaway device they pair.

## Known issues (OpenClaw 2026.9.6)

- **Code Mode.** By default OpenClaw may wrap tool calls in a small script
  (`exec`); the script can drop a tool's result, and the model then reports an
  empty page. The setup script turns Code Mode and tool search off for ECHO's
  profile, and gives avatars no skills (their list alone cost ~1,500 tokens a
  call). OpenClaw's own base prompt (~2,000 tokens) remains.
- **Tool errors over `tools.invoke`** come back as "tool execution failed"
  without the reason, which is why ECHO's tools report problems as results.

- **The same avatar in two browsers.** When two nodes offer a tool with the
  same name, the gateway renames both copies, so neither matches the agent's
  allowlist and the run fails with "No callable tools remain". Each browser
  offers only its assigned avatars' tools, so this happens only when one
  avatar has a tab in two browsers on the same gateway; the avatar then says
  to release it in the other browser.

- **claude-cli runtime and reconnects.** The warm Claude Code process stays
  bound to the operator connection that started it. After that connection
  closes, every tool call fails with *"Gateway client authority closed before
  dispatching node.invoke"* until the gateway restarts. ECHO's connection is
  replaced whenever Chrome restarts its service worker, so use an API-key
  provider (Gemini, Anthropic) for agents; claude-cli is for quick local tests
  on a freshly started gateway.
- When that tool call failed, the model answered from its memory of an earlier
  run (a stale code). Each avatar's `AGENTS.md` now forbids answering from
  memory; the harness work adds checks that enforce it.
- Through claude-cli each turn carries about 32k (cached) tokens of Claude Code
  system prompt.
- The gateway ticks every 30 s, which equals Chrome's service-worker idle
  limit; ECHO sends a `health` request every 20 s and keeps a 30 s wake alarm.

## Extension id

`manifest.json` carries a public key, so every build has the id
`ajppdcdcnfnnbjfkkoamikimkefjdhee`. The matching private key (needed only to
pack a `.crx` yourself) is at `~/.echo/echo-extension-key.pem` and must never be
committed. A Chrome Web Store listing gets its own key; put the store's public
key in `manifest.json` then, and run the setup script again.
