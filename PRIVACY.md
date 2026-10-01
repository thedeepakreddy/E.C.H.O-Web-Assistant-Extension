# ECHO Online Privacy Notice

Effective: October 1, 2026

ECHO Online is a browser extension that assists you on webpages. It is designed to do as much work locally as possible and does not operate a developer analytics, advertising, or data-broker service.

## What ECHO handles

Depending on the feature you choose, ECHO can handle your prompts, the current page URL and title, selected or relevant webpage text, visible form labels and non-sensitive field contents, tab information, tool results, conversations, preferences, memories, workflows, watchers, highlights, and locally indexed pages. ECHO's page reader excludes password, one-time-code, payment-card, and similarly sensitive input values.

API keys and connection settings that you enter are stored in Chrome's local extension storage. Chrome local extension storage is not an encrypted password vault. Agent mode can instead use credentials managed by the local Echo Helper and connected services.

## When data leaves the browser

Cloud AI is disabled until you accept the disclosure in ECHO Settings. When enabled and a request cannot be completed locally, ECHO sends your prompt and only the relevant context needed for that request to the provider you selected: Anthropic, Google, Together AI, OpenRouter, or Groq. Web-search requests can also be processed by the selected provider and its search service. Those companies process data under their own terms and privacy notices.

If you connect email, GitHub, OpenClaw, or another agent app, requested data is sent directly between the local helper and that service. ECHO asks for approval immediately before external messages, posts, account changes, destructive actions, and payments.

ECHO does not sell personal information, show targeted advertising, or send product analytics to the developer.

## Local storage and retention

Settings, chats, memories, cached answers, workflows, watchers, highlights, and the optional page index are stored on your device in Chrome extension storage or IndexedDB until you delete them or uninstall the extension. Remembering pages is off by default and requires a site to be added to the allow list. Known private mail, document, account, and collaboration pages are excluded from automatic indexing.

Private Agent Browsing uses an incognito window and an ephemeral conversation scope. Its chat messages, page URLs, actions, model conversation, and cached answers are not retained by ECHO after the task. Your selected cloud provider may retain requests according to its own policy.

You can export non-secret ECHO data, remove individual sites, clear remembered pages or cached answers, and delete all ECHO data from Settings. Export deliberately excludes API keys, device tokens, and app credentials. Turning off cloud consent prevents new cloud AI requests.

## Permissions and security

ECHO needs webpage access to read and act on pages you invoke it on, tab and scripting access for browser tools, storage for your local data, alarms and notifications for watchers, side-panel and context-menu access for its interface, and native messaging for the optional local helper. Network requests use HTTPS or secure WebSockets where supported. No software can guarantee absolute security; keep Chrome and ECHO updated and protect access to your operating-system account.

## Children

ECHO is not directed to children under 13 and does not knowingly collect children's personal information.

## Changes and contact

Material changes will use a new consent version so cloud AI remains off until the updated disclosure is accepted. Questions, security reports, or deletion issues can be filed through the [ECHO GitHub issue tracker](https://github.com/thedeepakreddy/Echo-Web-Assistant-Extension/issues).
