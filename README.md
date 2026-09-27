# ECHO Online

### A local-first AI browser assistant that understands pages, operates websites, remembers what matters, learns tasks by watching you, and runs agents in your tabs—by text or voice.

[![Version](https://img.shields.io/badge/version-3.0.0-b8a1ff)](manifest.json)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-127%20passing-34C759)](tests)
[![License](https://img.shields.io/badge/license-ISC-lightgrey)](package.json)

ECHO lives inside Chrome as an animated assistant, a persistent side-panel chat, and a complete settings dashboard. It can summarize and explain pages, navigate and click, fill safe form fields, extract structured information, manage tabs, learn a task by watching you do it, monitor pages, search the web, work with video transcripts, and help rewrite selected text.

With **agent mode** on, ECHO's characters become agents you assign to tabs: each works on its own in its tab, can use apps you connect (email, GitHub), and asks you before it pays or sends anything. **Claude Desktop and Claude Code** can use ECHO too, in a tab you share with them.

The unusual part is what happens behind the interface: ECHO tries fast local methods before contacting a cloud model. Simple requests stay quick and private, cached answers are reused, supported Chrome installations can use on-device AI, and cloud models are reserved for work that genuinely needs them.

> [Download the ready-to-install ECHO V3 ZIP](package%20for%20sharing/Echo_Web_Assistant_v3.zip) · [Build from source](#option-b--build-from-source) · [What's new in V3](#whats-new-in-v3) · [See everything ECHO can do](#complete-feature-guide)

---

## What's new in V3

| Feature | What it does |
| --- | --- |
| **Agents in your tabs** | Assign one of ECHO's characters to a tab and it works there on its own, even on long tasks, through [OpenClaw](https://docs.openclaw.ai) on your computer. [More](#agents-in-your-tabs) |
| **One Turn on button** | Agent mode turns on from the chat panel, the Echo panel or Settings. The only setup is one pasted command, once. [More](#turn-on-agents-optional) |
| **Watch me** | Show ECHO a task once; press it under **Your tasks** to do it again. If the site changed, an agent finishes it. [More](#watch-me-show-echo-a-task-once) |
| **Apps for agents** | Agents can use your email (Gmail, iCloud, Yahoo, any IMAP mailbox) and GitHub. Every email they send and every post they make asks you first. [More](#apps-for-agents-email-and-github) |
| **ECHO for Claude** | Claude Desktop and Claude Code can use ECHO's browser tools in a tab you share, with ECHO's rules. [More](#echo-for-claude-desktop-and-claude-code) |
| **A simpler chat panel** | An **Assign Agent** button, one ⋯ menu for everything else, and a new Echo panel with agent, chat-panel and settings buttons. |
| **Honest answers** | Agents read pages by reference, prove results before claiming success, and ECHO marks any number or name it could not find on the page. |

---

## See ECHO in motion

[![ECHO avatar expression showcase](docs/media/echo-avatar-expressions.gif)](docs/media/echo-avatar-expressions.mp4)

**[Play the full-resolution MP4](docs/media/echo-avatar-expressions.mp4)** — all seven avatars move through idle, listening, thinking, talking, and laughing states. The animation includes cursor-aware gaze, natural blinking, head and body motion, text-driven mouth shapes, happy squints, and animated laughter tears.

Every avatar uses the real production animation component and recolors the floating assistant, side panel, and settings interface with its own theme.

---

## What ECHO feels like to use

### On any webpage

Press `Ctrl/Cmd + Shift + E` to wake ECHO, click the avatar to speak, or long-press it to open the **Echo panel**.

![The Echo panel over a webpage: Turn on agents, chat panel and settings buttons, quick actions and Your tasks](docs/screenshots/v3-echo-panel.png)

The floating assistant stays above the current page without replacing it. The Echo panel has **Turn on agents**, buttons for the chat panel and settings, one-click actions (summarize, explain, translate, fill a form, **Watch me**, list tabs), and **Your tasks**: the tasks you showed ECHO, ready to do again.

### In the side panel

Press `Ctrl/Cmd + Shift + O` for a persistent conversation that follows you between tabs.

| Chat | Assign Agent |
| --- | --- |
| ![The ECHO chat panel](docs/screenshots/v3-side-panel.png) | ![Assign Agent: choose an agent for this tab](docs/screenshots/v3-assign-agent.png) |

**Assign Agent** gives the current tab to one of ECHO's agents; each agent you assign gets its own thread. Every answer can show which intelligence tier produced it, with citations for web searches. Chat history, temporary chats, page memory for the site, recent actions and settings are one ⋯ menu away.

### When ECHO notices an opportunity to help

With proactive suggestions enabled, ECHO can offer a local summary on a long article or help with an empty form. It does not start a model call until you accept.

![ECHO proactive suggestion](docs/screenshots/in-page-proactive-suggestion.png)

### When writing on the web

Select text in a field and use ECHO Writer to rewrite it. Review the result, copy it, or replace only the original selection.

![ECHO Writer rewrite card](docs/screenshots/in-page-writer.png)

---

## Install ECHO V3

### Option A — Use the ready-made ZIP

This is the easiest route for non-technical users.

1. [Download `Echo_Web_Assistant_v3.zip`](package%20for%20sharing/Echo_Web_Assistant_v3.zip).
2. Unzip it. The extracted folder contains the production extension files.
3. Open Chrome and enter `chrome://extensions` in the address bar.
4. Turn on **Developer mode** in the upper-right corner.
5. Choose **Load unpacked**.
6. Select the extracted folder—the folder that contains `manifest.json`.
7. Pin **ECHO Online** from Chrome's Extensions menu for easy access.
8. Open ECHO's **Options** page to choose an avatar, provider, language, and privacy preferences.

Chrome may remove a manually loaded extension when its source folder moves. Keep the extracted folder in a permanent location.

### Option B — Build from source

Use this route if you want to inspect, modify, or contribute to the code.

```bash
git clone https://github.com/thedeepakreddy/Echo-Web-Assistant-Extension.git
cd Echo-Web-Assistant-Extension
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the generated `dist/` folder.

### Do I need an API key?

No API key is required for local features such as direct navigation, page extraction, safe form filling, saved memories, workflow management, highlights, cached answers, and the built-in extractive summarizer.

An API key is required when a request reaches the cloud tier. ECHO supports:

| Provider | Best for | Configuration |
| --- | --- | --- |
| Anthropic Claude | Complex reasoning, tool use, cited web search | Anthropic Console key and model ID |
| Google Gemini | General assistance and Google-grounded search | Google AI Studio key |
| Groq | Fast responses and a useful free starting tier | Groq key and supported model |
| Together AI | Open-model choice | Together key and model ID |
| OpenRouter | Access to multiple hosted models | OpenRouter key and selected model |

API keys stay in Chrome's local extension storage. They are excluded from ECHO's data export.

### Turn on agents (optional)

Agents are optional; everything above works without them. They run on [OpenClaw](https://docs.openclaw.ai) (free and open source) on your own computer.

1. Press **Turn on agents** on the Echo panel, **Turn on** in the chat panel's Assign Agent sheet, or **Turn on agent mode** in Settings.
2. **The first time**, ECHO shows one command to copy and paste in Terminal. It installs **Echo Helper**, a small program that lets ECHO's buttons set up and start OpenClaw (Chrome never lets an extension install programs), and OpenClaw itself if it is missing.
3. ECHO carries on by itself: it sets up your agents, starts OpenClaw as a background service and approves your browser. It takes about a minute.
4. If OpenClaw has no AI yet, ECHO uses the Gemini or Claude key already saved in ECHO, or asks for one. The key goes to OpenClaw on this computer.

<img src="docs/screenshots/v3-agent-mode-setup.png" alt="Agent mode: the one-time Echo Helper install" width="320">

Needs macOS or Linux, and Node.js (OpenClaw's requirement). **Turn off** stops OpenClaw's service. After the first time, Turn on and Turn off are just buttons.

---

## First five minutes

After installation, try these commands:

```text
summarize this page
explain the selected text in simple words
extract all emails from this page
find every price on this page
open YouTube and search for lo-fi music
fill this form
list my open tabs
remember that I prefer short bullet points
what did I read today?
watch this page and tell me when the price drops below 800
```

Then try **Watch me** on a form you fill often, and (with agent mode on) **Assign Agent** on a shopping or research tab.

Useful controls:

| Action | Shortcut or gesture |
| --- | --- |
| Wake or hide the floating assistant | `Ctrl/Cmd + Shift + E` |
| Open the persistent side panel | `Ctrl/Cmd + Shift + O` |
| Open the Echo panel | `Ctrl/Cmd + Shift + K` or long-press the avatar |
| Teach ECHO a task | **Watch me** on the Echo panel, then **Done** on the recording bar |
| Give a tab to an agent | Chat panel → **Assign Agent** |
| Share a tab with Claude | Chat panel → **Assign Agent → Claude → Share this tab** |
| Start/stop voice input | Click the avatar |
| Move the assistant | Drag the avatar |
| Run a saved skill | Type `/shortcut` |
| Attach an open tab to a question | Type `@` in the side-panel composer |
| Ask from the address bar | Type `echo`, press `Space`, then enter a request |

---

## Interface tour

### Floating in-page assistant

The in-page experience includes:

- Seven animated character choices plus the classic reactor orb.
- Listening, thinking, speaking, error, and idle status feedback.
- The Echo panel: voice input, stop control, text input, quick actions, **Your tasks**, and buttons to turn on agents, open the chat panel and open settings.
- A recording bar at the top of the page while ECHO watches you (steps so far, **Done**, **Cancel**).
- A small response bubble beside the avatar.
- ECHO Writer cards for selected text.
- Proactive suggestion toasts.
- A separately framed approval prompt for payments and sending messages, including those by agents and by Claude.
- Drag positioning saved across pages.

| Echo panel | Watch me | Proactive help | ECHO Writer |
| --- | --- | --- | --- |
| ![Echo panel](docs/screenshots/v3-echo-panel.png) | ![Watch me recording bar](docs/screenshots/v3-watch-me-recording.png) | ![Proactive suggestion](docs/screenshots/in-page-proactive-suggestion.png) | ![Writer card](docs/screenshots/in-page-writer.png) |

### Persistent side panel

The side panel is the main workspace for longer conversations and multi-step tasks.

| Home | Assign Agent | History |
| --- | --- | --- |
| ![Side-panel home](docs/screenshots/v3-side-panel.png) | ![Assign Agent](docs/screenshots/v3-assign-agent.png) | ![History](docs/screenshots/side-panel-history.png) |

It includes:

- **Assign Agent**: give the current tab to one of ECHO's agents, turn agent mode on, and see which agent works where. Each agent gets its own thread, with starter ideas.
- Saved and temporary chats.
- Tier badges for instant, cached, on-device, and cloud answers, and an "unverified" mark on facts an agent could not find on the page.
- Cited sources for supported web-search answers.
- `/` skill completion and `@` tab completion, as buttons in a new chat.
- Web-search and private-window switches.
- A visible stop button while work is running.
- Approval prompts for payments and sends, by ECHO, its agents, their apps, or Claude.
- One ⋯ menu for chat history, temporary chat, page memory for the site, recent actions and settings.

### Settings

Settings are grouped in plain language so casual users can configure ECHO without understanding its architecture.

<table>
  <tr>
    <td><img src="docs/screenshots/settings-appearance-and-provider.png" alt="Appearance settings and all avatars"></td>
    <td><img src="docs/screenshots/settings-provider-and-local-brain.png" alt="Provider and local brain settings"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings-local-voice-personalization.png" alt="Local brain, voice and personalization settings"></td>
    <td><img src="docs/screenshots/settings-memory-skills-privacy.png" alt="Memories, skills and privacy settings"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings-privacy-and-data-controls.png" alt="Privacy and data controls"></td>
    <td><img src="docs/screenshots/settings-private-diagnostics-shortcuts.png" alt="Private browsing, diagnostics and shortcuts"></td>
  </tr>
</table>

#### Appearance

Choose one of seven animated ECHO personalities or the original reactor:

| Appearance | Personality | Voice |
| --- | --- | --- |
| Echo | Friendly lab assistant | Female |
| Echo Style | Style advisor | Female |
| Echo Officer | Safety officer | Male |
| Echo Patrol | Patrol partner | Female |
| Echo Mentor | Wise mentor | Female |
| Echo Visionary | Tech visionary | Male |
| Echo Analyst | Skeptical analyst | Male |
| Reactor | Classic arc-reactor orb | Uses the selected system voice |

The selected character's palette automatically themes every ECHO surface.

#### AI Provider

Choose a provider, enter its API key, and select or enter a supported model. Only the active provider is used for cloud-tier requests.

#### Local Brain

- **Answer locally first:** tries deterministic, cached, and on-device answers before the cloud.
- **Reuse past answers:** stores suitable answers and replays them for matching questions.
- **On-device summarising:** uses Chrome's built-in AI when available, with an extractive fallback.
- **Remember pages you read:** locally indexes allowed sites for later recall.
- **Proactive suggestions:** offers help on long articles and forms without starting a cloud request.

#### Voice

- **Hands-free mode:** reopens the microphone after ECHO finishes speaking.
- **Language:** English (US/UK), Hindi, Telugu, Tamil, Bengali, Spanish, French, and German.
- **Web search:** automatic when useful, or only when explicitly requested.

#### Personalization

Set your name, preferred answer style, background information, and custom instructions. Personalization is stored locally and can be disabled or edited at any time.

#### Memories

Review, search, add, edit, reveal, forget, or delete remembered facts. You can also teach ECHO conversationally—for example, “remember that my city is Hyderabad.”

#### Skills

Skills are reusable prompts with short `/commands`. Create your own, edit existing ones, or restore the built-in set.

#### Privacy and data controls

- See how many pages are remembered.
- Allow page memory one domain at a time.
- Forget a domain and remove its saved pages and highlights.
- Export ECHO data without API keys.
- Delete remembered pages, cached answers, or all ECHO data.

#### Private Agent Browsing

Runs browser tasks in a separate incognito window with no normal cookies, logins, or browsing history. HTTPS is required, and payment or send actions still require approval. Chrome's **Allow in Incognito** permission must be enabled first.

#### Diagnostics

Checks browser permissions, the active tab, provider configuration, API-key presence, and model availability without sending a prompt or spending tokens.

#### Agent mode

**Turn on agent mode** (the one-time Echo Helper install, then a button), live progress while it turns on, **Turn off**, and Advanced options for people who run OpenClaw themselves (its address and token, or the full setup command).

#### Apps for agents

Connect **Email** (Gmail, iCloud, Yahoo, or any IMAP/SMTP mailbox, with an app password) and **GitHub** (your GitHub CLI sign-in, or a token), and choose which agents may use each one.

<img src="docs/screenshots/v3-apps-settings.png" alt="Apps for agents in Settings" width="560">

#### Claude Desktop & Claude Code

**Let Claude use ECHO** (off by default), its status, the tab you shared, and **Add to Claude Code** / **Add to Claude Desktop**.

<img src="docs/screenshots/v3-claude-settings.png" alt="Claude Desktop and Claude Code in Settings" width="640">

---

## Complete feature guide

### Understand pages

- Read visible text and a numbered index of interactive elements.
- Extract long pages in safe chunks rather than silently truncating them.
- Summarize locally or with a selected AI provider.
- Answer questions from page content.
- Explain selected text in simple language.
- Extract tables as structured JSON.
- Capture the visible page for genuinely visual questions.
- Find and highlight matching text.
- Translate page content.

### Navigate and operate websites

- Open URLs and wait for navigation to finish.
- Click indexed elements rather than brittle pixel coordinates.
- Type using native setters so React and Vue forms detect changes.
- Press keys, scroll, switch tabs, close tabs, and list open tabs.
- Search supported websites through direct search URLs.
- Track the correct active tab across multi-step tasks.

### Fill forms safely

ECHO scores visible fields against saved profile information and fills only safe matches. It deliberately refuses:

- Passwords.
- Card numbers and CVV codes.
- PINs.
- Social-security numbers.
- Bank or account numbers.
- Fields that already contain user-entered text.

It fills but does not submit the form. You remain in control of the final action.

### Agents in your tabs

With agent mode on, **Assign Agent** gives a tab to one of ECHO's eight agents (the seven characters and the Core orb). Each agent is an OpenClaw agent that:

- works only in its own tab (and tabs it opens from there), in parallel with the others, and keeps working when you look away;
- reads the page as text with references like `[e12]`, acts by reference, and sees only what changed after each step, which keeps answers accurate and tokens low;
- proves a result (the URL, exact quotes, field states) before saying a task is done; ECHO marks any number, name or date in a reply that no tool actually read;
- uses your recorded tasks, page watchers, and connected apps;
- asks you before paying or sending anything, and stops if you deny it.

If OpenClaw is not running, an agent falls back to ECHO's built-in brain, so a request is never left hanging. Talk to an agent in its thread in the chat panel, or on its tab's Echo panel.

### Watch me: show ECHO a task once

Press **Watch me** on the Echo panel and do the task as usual. A bar at the top of the page counts the steps; press **Done**, name the task, and **Save**. It appears under **Your tasks** on the Echo panel: press it to do the task again.

| Recording | Naming it |
| --- | --- |
| ![ECHO is watching: 5 steps, Done, Cancel](docs/screenshots/v3-watch-me-recording.png) | ![Name it and Save](docs/screenshots/v3-watch-me-name.png) |

- ECHO records committed clicks, typing, dropdown choices, scrolling and navigation, never passwords, card fields or ECHO's own controls.
- Each step keeps several selector candidates and a readable label, so replays survive generated IDs and changing class names.
- A replay uses no AI and no tokens. If the site changed and a step no longer fits, and agent mode is on, an agent takes the tab, does that step itself and runs the rest.
- "Do *task* for Bob" is not a plain replay: an agent reads the recorded steps and does them with the new details.
- You can still say "record a workflow", "stop recording and call it …", "run …" and "list my workflows".

### Monitor pages

Ask ECHO (or an agent) to watch a page, for example "tell me when this page changes" or "watch this page and tell me when the price drops below 800". A watcher can look for:

- Any content change.
- A value moving below or above a threshold.
- Text appearing.
- An element disappearing.
- A price reaching a target.

Chrome alarms reopen the page in a background tab, evaluate the condition, and show a desktop notification. Watchers survive browser restarts and re-arm when their condition becomes false again.

### Extract useful information

Built-in local extractors find:

- Email addresses.
- Phone numbers with plausibility filtering.
- Prices in multiple currencies.
- Links.
- Dates in common formats.
- Social-media handles.
- Page headings.
- Tables and structured page content.

### Remember pages and highlights

- Opt in one site at a time.
- Save selected passages as highlights.
- Restore highlights when revisiting a page.
- Export highlights as Markdown.
- Ask “what did I read today?” or recall an article by topic.
- Rank page memory by title, domain, body matches, and recency.

ECHO automatically excludes private destinations such as mail, online documents, authentication pages, account pages, and token-bearing URLs.

### Search the web with citations

Claude and Gemini can perform live web searches when supported by the selected model and account. Search answers can include numbered markers and a source list in the side panel. Web search can be automatic or explicitly controlled per message.

### Work with video

On supported video pages, ECHO can retrieve and parse timed transcripts. This enables summaries, topic lookup, and questions about the spoken content without treating the visual page layout as the transcript.

### Rewrite selected text

ECHO Writer captures exactly the selected text inside an editable field. It refuses stale selections and secret fields, removes unwanted model wrappers, and offers **Copy** or **Replace** instead of changing the page automatically.

### Use voice naturally

- Speech recognition runs in a sandboxed extension frame so it works consistently across sites.
- Spoken replies use browser speech synthesis.
- Character voice gender remains consistent with the selected avatar.
- Mouth shapes are generated from the reply text and corrected by speech boundary events when the browser provides them.
- Hands-free mode continues the conversation after each answer.

### Create reusable skills

Turn a good prompt into `/tldr`, `/email`, `/explain`, or your own shortcut. Skills work in the side panel, page command bar, and address bar.

### Attach tab context

Type `@` in the side panel to attach an open tab. Attached content is fenced and explicitly treated as untrusted page data rather than system instructions.

### Use a private agent window

Private mode confines the task to a separate incognito window, requires HTTPS, and prevents tools from silently escaping back into the normal signed-in browsing context.

### Apps for agents: email and GitHub

Connect apps in **Settings → Apps for agents** and choose which agents may use each one (an agent without an app never sees its tools).

- **Email**: search, read, send and reply from your own address. It signs in with an **app password** (Gmail needs 2-Step Verification; iCloud and Yahoo have their own), not your usual password.
- **GitHub**: read repositories, issues and pull requests, open issues and comment. Agents cannot push, merge or delete.
- **Asking before sending**: every email an agent sends and every post it makes waits for **Allow once** or **Deny** in ECHO, exactly like a send in the browser. No answer in time, or Stop, means no.

<img src="docs/screenshots/v3-app-approval.png" alt="An agent's email waits for Allow in the chat panel" width="320">

Passwords and tokens go straight from the settings page to Echo Helper, into files only you can read. They are not kept by ECHO, not in OpenClaw's settings, and never on a command line.

### ECHO for Claude Desktop and Claude Code

ECHO is also an MCP server, so Claude can use your real browser through it:

1. **Settings → Claude Desktop & Claude Code → Let Claude use ECHO** (it needs Echo Helper; ECHO offers to install it).
2. **Add to Claude Code** or **Add to Claude Desktop** (or, with Claude Code's command-line tool: `claude mcp add echo -- ~/.openclaw-echo/echo-helper/echo-mcp`).
3. In the chat panel, **Assign Agent → Claude → Share this tab** on the page you want Claude to use. **Stop sharing** takes it back.

| Sharing a tab | Claude asks before sending |
| --- | --- |
| ![Claude is using a shared tab](docs/screenshots/v3-claude-share.png) | ![Claude asks: allow this?](docs/screenshots/v3-claude-approval.png) |

Claude gets ECHO's browser tools (observe, act, navigate, read, extract, verify and more) in the shared tab only, with ECHO's rules: no password, card or code fields, and paying or sending waits for **"Claude asks: allow this?"**. It needs no OpenClaw, and nothing listens on the network: Claude's `echo-mcp` reaches ECHO through Echo Helper over a socket only you can open.

---

## How the local-first brain works

```text
User request
     │
     ▼
┌──────────────────────┐
│ Smart request router │
└──────────┬───────────┘
           │
   ┌───────┼──────────┬────────────┐
   ▼       ▼          ▼            ▼
Tier 0   Tier 1     Tier 2       Tier 3
Instant  Cache      On-device    Cloud model
rules    + memory   AI/fallback  + tools
   │       │          │            │
   └───────┴──────────┴────────────┘
           │
           ▼
 Answer with a visible tier label
```

| Tier | What it handles | Typical cost | Can decline? |
| --- | --- | --- | --- |
| Tier 0 — Instant | Direct navigation, memory lookups, extractors, workflows, form filling, watchers, tab commands | Free and local | Yes |
| Tier 1 — Cached | Matching prior answers and local knowledge recall | Free and local | Yes |
| Tier 2 — On-device | Summaries and page-grounded questions through Chrome AI or the extractive fallback | Free and local | Yes |
| Tier 3 — Cloud | Open-ended reasoning, complex agentic tasks, and live web search | Uses provider quota | Final tier |

The important rule is that each local tier may say **“I am not confident”** and pass the request onward. A fast local guess is not considered a success.

Agents follow the same idea: local skills (stop, workflows, extractors) answer first, a recorded task replays without a model, and only real work reaches the agent's model.

### Why this saves tokens

- Simple work never sends a prompt.
- Repeated questions reuse suitable answers.
- Old tool output is compacted before the next model step.
- Only relevant tool definitions are sent for a request.
- The agent loop has a hard step cap and abort support.
- Cloud results can be written back to the cache.
- Real provider usage fields feed the visible token counter.

---

## Privacy and safety model

ECHO can operate websites, so its boundaries are designed to be visible and conservative.

### Local by default

- Settings, memories, workflows, watchers, highlights, chat history, and the page index live in Chrome storage or IndexedDB on the device.
- Page memory is opt-in per domain.
- Private sites and sensitive URL patterns are automatically excluded.
- Data export omits API keys.

### Approval before consequential actions

ECHO asks before actions that can pay, send an email, or send a message, and only then; everything else runs and is written to the action log. The same rule covers ECHO's agents, the apps they use (through Echo guard, a small OpenClaw plugin), and Claude. Approval is tied to the originating tab so another page cannot approve it, and a denied send is not asked about again in the same task.

### Agents and helpers stay in bounds

- Each agent works only in the tab it was given, and may use only its own tools and the apps you chose for it. Agents have no shell, no files, and no OpenClaw browser.
- Agents may open addresses they have seen on their pages, site home pages or web searches; they never guess deep links.
- Echo Helper starts only for ECHO's extension id and runs a fixed set of commands with checked arguments, never a shell or a command it was sent.
- OpenClaw listens on this computer only and accepts only ECHO; ECHO pairs with it using a key it made itself.
- Claude works only in a tab you share, and only while **Let Claude use ECHO** is on.

### Prompt-injection boundaries

- Page text, attached tabs, browser results, and tool output are treated as untrusted data.
- Proactive page messages may only select from a fixed allowlist of harmless local actions.
- Navigation rejects executable schemes such as `javascript:` and `data:`.
- Screenshot capture refuses to capture a different active tab.

### Important permission explanations

| Permission | Why ECHO needs it |
| --- | --- |
| `activeTab` / `scripting` | Read and interact with the page you ask ECHO to use |
| `tabs` | Navigate, switch, list, and manage tabs during tasks |
| `storage` / `unlimitedStorage` | Save settings, chats, workflows, cache, highlights, and local knowledge |
| `sidePanel` | Provide persistent chat beside the webpage |
| `alarms` / `notifications` | Check page watchers and notify you when conditions match |
| `downloads` | Export user-requested data and highlights |
| `contextMenus` | Offer ECHO actions on selected page text |
| `<all_urls>` host access | Run the assistant on the sites where you explicitly invoke it |
| `nativeMessaging` | Talk to Echo Helper, which turns agent mode on and off, connects apps, and lets Claude reach ECHO |

---

## Troubleshooting

### ECHO does not appear on a page

1. Reload the page after installing or rebuilding the extension.
2. Press `Ctrl/Cmd + Shift + E`.
3. Confirm the extension is enabled at `chrome://extensions`.
4. Chrome does not allow extensions to run on some internal pages such as `chrome://settings`.

### The cloud provider does not answer

1. Open ECHO **Options**.
2. Confirm the selected provider, API key, and model.
3. Run **Diagnostics → Health check**.
4. Check that the provider account has quota and access to the selected model.
5. Try a local command such as “extract all emails” to verify the extension itself is working.

### Voice input does not work

- Allow microphone access when Chrome asks.
- Confirm the selected language in **Settings → Voice**.
- Close other applications that may exclusively hold the microphone.
- Reload the webpage after changing extension permissions.

### Private browsing says setup is required

Open `chrome://extensions`, select ECHO's **Details**, and enable **Allow in Incognito**. ECHO does not enable this permission automatically.

### A recorded workflow cannot find an element

The website may have changed its labels or layout. Record that step again. ECHO deliberately avoids replaying against ambiguous or sensitive elements.

### Agent mode does not turn on

- The first time, paste the install command ECHO shows into Terminal; ECHO carries on by itself when it finishes.
- Keep ECHO's chat panel or settings open while it turns on (about a minute).
- If it says the AI is out of quota, your key's free tier is used up for now; wait a minute, or use a key with more quota.
- Running OpenClaw your own way: use **Settings → Agent mode → Advanced** to enter its address and token.

### An agent cannot send an email or post

The agent needs the app (**Settings → Apps for agents**, with that agent chosen), and ECHO must be open to ask you. If Settings says agents can't ask yet, press **Turn agent mode on again** once.

### Claude cannot reach ECHO

- **Settings → Claude Desktop & Claude Code**: **Let Claude use ECHO** must be on, and the status must say Ready.
- Share a tab with Claude (chat panel → **Assign Agent → Claude**).
- After **Add to Claude Desktop**, quit and reopen Claude Desktop; after **Add to Claude Code**, start a new session.

### Chrome says the unpacked extension is missing

The extracted or `dist/` folder was probably moved. Remove the broken entry from `chrome://extensions` and load the folder again from its permanent location.

---

## Developer guide

### Technology

| Area | Implementation |
| --- | --- |
| Language | TypeScript 5 in strict mode |
| UI | React 19 with custom CSS and no component framework |
| Build | webpack 5 and `ts-loader` |
| Platform | Chrome Extension Manifest V3 |
| Background | Restart-safe service worker with persisted task state |
| Local data | Chrome storage plus IndexedDB |
| On-device AI | Chrome `Summarizer` / `LanguageModel`, feature-detected |
| Cloud AI | Claude, Gemini, Groq, Together AI, OpenRouter |
| Agents | OpenClaw gateway (protocol v4) through `@openclaw/gateway-client`, ECHO as both node and operator |
| Echo Helper | A Node.js native-messaging host, plus Echo guard (OpenClaw plugin), the email and GitHub apps, and `echo-mcp` (MCP server) |
| Voice | Web Speech API in a sandboxed extension frame |
| Testing | Node's built-in test runner with TypeScript module harnesses |

### Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ User interfaces                                              │
│ Floating avatar + command bar │ Side panel │ Settings        │
└───────────────────────────────┬──────────────────────────────┘
                                │ Chrome messages
┌───────────────────────────────▼──────────────────────────────┐
│ MV3 background service worker                               │
│ Router · local brain · cache · provider brain · safety bus  │
│ workflows · watchers · chats · memories · web search        │
└───────────────┬───────────────────────────┬──────────────────┘
                │                           │
┌───────────────▼──────────────┐  ┌────────▼──────────────────┐
│ Content script              │  │ Local persistence         │
│ DOM index · actions         │  │ Chrome storage · IndexedDB│
│ recorder · form filler      │  │ cache · KB · highlights   │
│ highlighter · writer        │  └───────────────────────────┘
│ transcript · page UI        │
└──────────────────────────────┘

Agent mode and Claude (optional), all on this computer:

 ECHO (service worker) ──WebSocket── OpenClaw gateway ── agents' AI model
     │  node: agents' browser tools        │  apps: echo-mail, echo-github (MCP)
     │  operator: runs, approvals          └─ Echo guard: "Allow?" for sends/payments
     │
     └──native messaging── Echo Helper ── Unix socket ── echo-mcp ── Claude Desktop / Code
```

### Project structure

```text
.
├── manifest.json                    Chrome MV3 manifest
├── webpack.config.js                Production bundling
├── src/
│   ├── background/
│   │   ├── smart-router.ts          Four-tier request dispatch
│   │   ├── local-brain.ts           Deterministic intent rules
│   │   ├── response-cache.ts        Normalized TTL answer cache
│   │   ├── local-llm.ts             Chrome AI + extractive fallback
│   │   ├── brain.ts                 Cloud provider agent loops
│   │   ├── safety.ts                Navigation and approval boundaries
│   │   ├── workflow-engine.ts       Record/replay orchestration
│   │   ├── page-watcher.ts          Alarm-driven monitoring
│   │   ├── knowledge-base.ts        Local page recall
│   │   ├── chats.ts                 Saved and temporary chats
│   │   ├── tools.ts                 Browser tool dispatch
│   │   ├── grounding.ts             Marks facts no tool read
│   │   ├── claude-bridge.ts         ECHO's tools for Claude (MCP)
│   │   ├── agents/leases.ts         Which agent (or Claude) holds which tab
│   │   └── openclaw/                Gateway connection, sessions, agents'
│   │                                browser tools, app approvals, agent mode
│   ├── helper/                      Echo Helper, Echo guard, email and
│   │                                GitHub apps, echo-mcp
│   ├── content/
│   │   ├── actions.ts               Indexed DOM and browser actions
│   │   ├── avatar.tsx               Real-time avatar animation engine
│   │   ├── ui.tsx                   Floating assistant and command bar
│   │   ├── command-bar.tsx          The Echo panel
│   │   ├── snapshot.ts              Page references and change-only views
│   │   ├── recorder.ts              Watch me: capture, recording bar, replay
│   │   ├── form-filler.ts           Safe profile-based form filling
│   │   ├── writer.ts                Selection-bound rewrite flow
│   │   └── video-transcript.ts      Timed transcript parsing
│   ├── popup/
│   │   ├── sidepanel.tsx            Persistent chat workspace
│   │   └── options.tsx              Complete settings interface
│   ├── characters/                  Character registry and themes
│   └── assets/characters/           Layered avatar artwork
├── tests/                           Unit tests (node --test)
├── tools/e2e/, tools/openclaw/      End-to-end tests in Chrome for Testing
├── tools/avatar/                     Avatar asset-generation pipeline
├── tools/docs/                       Reproducible screenshot/video harness
├── docs/screenshots/                 README screenshots
└── docs/media/                       Avatar MP4, GIF preview and poster
```

### Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Build the production extension into `dist/` |
| `npm test` | Run the automated test suite |
| `npm run e2e:watch-me` | Watch me end to end in Chrome for Testing |
| `npm run e2e:claude` | ECHO for Claude end to end, playing Claude over MCP |
| `npm run openclaw:approvals-e2e` | Apps and approvals with a throwaway gateway and a scripted model |
| `npm run openclaw:turn-on-e2e` | The Turn on button with a real OpenClaw (restarts ECHO's gateway) |
| `npm run docs:showcase` | Build the documentation sandbox |
| `npm run docs:capture` | Rebuild and regenerate screenshots plus avatar video; requires Chrome and FFmpeg |

### Testing coverage

The unit suite (127 tests) covers, among others:

- Page-scoped cache isolation.
- Sensitive-field redaction and typing refusal.
- Executable URL rejection.
- Private-site and token-bearing URL exclusions.
- Tab-bound action approval.
- Service-worker restart recovery.
- Long-page chunking.
- Active-tab screenshot safety.
- Workflow recording and replay.
- Dropdown and multi-select restoration.
- Skills and chat-history behavior.
- Personalization and temporary-chat isolation.
- Citation parsing.
- Video transcript parsing.
- ECHO Writer selection safety.
- Attached-tab prompt-injection fencing.
- Incognito task confinement.
- Character/voice matching.
- On-device AI timeout behavior.
- The OpenClaw connection, sessions, tool routing, per-agent tool isolation and reconnects.
- Grounding: page references, stale references, quote checks and unverified claims.
- Echo Helper: checked setup data, locked-down agents, app credentials kept off command lines.
- Echo guard's send/pay rule, ECHO's app approvals, and the email and GitHub apps.
- The Claude bridge, `echo-mcp`, and adding ECHO to Claude.
- Watch me: never recording ECHO's own controls, and task names that change a task going to an agent.

End-to-end tests in Chrome for Testing are listed in [tools/openclaw/README.md](tools/openclaw/README.md#checks). The ones that need a model use a scripted stand-in, so they spend no quota.

### Documentation media

`tools/docs/capture-media.mjs` mounts the real production React components inside a deterministic local sandbox. Sample names, memories, chats, and URLs are fictional; no developer profile, API key, or browsing history is captured. The avatar reel uses the production `EchoAvatar` animation component and source artwork.

To regenerate everything:

```bash
npm run docs:capture
```

Requirements: macOS with Google Chrome at its standard application path and `ffmpeg` available on `PATH`.

---

## Current limitations

- The deterministic intent layer is deliberately conservative and can decline unfamiliar phrasing.
- Chrome's highest-quality built-in AI path is hardware- and browser-dependent; the extractive fallback remains available.
- A recorded workflow can require re-recording after a website significantly changes its labels or structure.
- Browser speech recognition and installed voices vary by operating system.
- Web search availability depends on the selected provider, model, account, and quota.
- This repository currently distributes an unpacked extension ZIP rather than a Chrome Web Store release.
- Agent mode needs macOS or Linux and Node.js, and a one-time command in Terminal (Chrome cannot install programs).
- Agents' quality and speed depend on the AI behind OpenClaw; free tiers can run out of quota mid-task.
- Email for agents uses an app password: Google's official Gmail connector cannot send mail and needs your own Google Cloud app.
- GitHub for agents reads and talks in issues; it cannot push, merge or delete.
- Claude can use one shared tab (and the tabs it opens from it) at a time.

---

## Contributing

1. Create a short-lived feature branch.
2. Keep changes focused and commits atomic.
3. Run `npm test` and `npm run build`.
4. Include screenshots for visible interface changes.
5. Never commit real API keys, browser profiles, private page content, or generated `dist/` output.
6. Explain user-facing behavior and privacy implications in the pull request.

---

## License

ISC. See [package.json](package.json) for the current package metadata.
