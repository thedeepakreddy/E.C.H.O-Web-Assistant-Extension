# Changelog

## [3.0.0] - 2026-10-01

### Added

- Wake-and-listen shortcut: quickly tap Option on macOS or Alt on Windows.
- First-run cloud privacy consent and a complete user-facing privacy disclosure.
- Release validation, checksummed packaging, Chromium smoke tests, and extension icons.

### Changed

- Load the visual assistant and AI provider SDKs only when needed to reduce normal-page overhead.
- Limit page access to HTTP and HTTPS sites.
- Update the supported Claude and Gemini model defaults.

### Fixed

- Keep cached answers scoped to the originating page instead of reusing fuzzy cross-site matches.
- Restore highlights reliably across whitespace and split text nodes.
- Make OpenClaw helper discovery portable and remove dynamic code execution from setup.
- Prevent private-mode conversations, model state, actions, and cached responses from persisting.

### Security

- Require explicit approval for destructive, account, permission, payment, publishing, email, and messaging actions.
- Restrict connected-app mutations and verify email-reply recipients.
- Strengthen prompt boundaries between web content, user instructions, and system instructions.
