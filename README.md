# ECHO Online

### A local-first multimodal browser-agent orchestration system for Chrome: it observes and acts on pages, routes requests through a local-first intelligence stack, and can delegate tab-scoped work to autonomous agents with human approval gates.

[![Version](https://img.shields.io/badge/version-3.0.0-b8a1ff)](manifest.json)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-127%20passing-34C759)](tests)
[![License](https://img.shields.io/badge/license-ISC-lightgrey)](package.json)

ECHO lives inside Chrome as an animated assistant, a persistent side-panel chat, and a complete settings dashboard. It combines a browser-native UI layer, a safety-governed service worker, page-aware content scripts, local memory and workflow storage, and a four-tier local-first routing system that tries instant, cached, on-device, and cloud execution in order. It can summarize and explain pages, navigate and click, fill safe form fields, extract structured data, and work with voice, text, and page context.

With agent mode on, ECHO's characters become tab-scoped agents you assign to individual tabs: each works on its own in its tab, can use apps you connect (email, GitHub), and asks you before it pays or sends anything. ECHO also exposes its browser tools to Claude Desktop and Claude Code through the MCP bridge, so Claude can use a shared tab under ECHO's rules and approval boundaries.

The unusual part is what happens behind the interface: ECHO tries fast local methods before contacting a cloud model. Simple requests stay quick and private, cached answers are reused, supported content can be handled on-device, and only the work that genuinely needs a model reaches the cloud tier. This keeps requests cheap, fast, and predictable while preserving clear approval checks for consequential actions.
