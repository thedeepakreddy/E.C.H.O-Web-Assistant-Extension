// The one step agent mode cannot do from the browser: putting Echo Helper on
// this computer (Chrome never lets an extension install or start programs).
// After this one-time command, ECHO's "Turn on" and "Turn off" buttons ask the
// helper to do everything else: no terminal, no copied tokens.

import helperSource from '../../helper/echo-helper.mjs?raw';
import { PROFILE, TESTED_OPENCLAW, setupCommand } from './setup-script';

/** Chrome's name for Echo Helper (native messaging). */
export const HELPER_HOST = 'com.echo.helper';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Where each Chromium browser looks for native messaging hosts, per user.
const BROWSER_DIRS = [
  'Library/Application Support/Google/Chrome', 'Library/Application Support/Google/Chrome Beta',
  'Library/Application Support/Google/Chrome Dev', 'Library/Application Support/Google/Chrome Canary',
  'Library/Application Support/Chromium', 'Library/Application Support/BraveSoftware/Brave-Browser',
  'Library/Application Support/Microsoft Edge',
  '.config/google-chrome', '.config/google-chrome-beta', '.config/chromium',
  '.config/BraveSoftware/Brave-Browser', '.config/microsoft-edge',
];

export function helperInstallScript(extensionId: string, echoVersion: string): string {
  const manifest = JSON.stringify({
    name: HELPER_HOST, description: 'Echo Helper: turns ECHO agent mode on and off', path: '__PATH__', type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  });
  return `#!/bin/bash
# Echo Helper for ECHO ${echoVersion} (extension ${extensionId}): installs OpenClaw
# if needed, then the small helper ECHO's Turn on button talks to. One time only.
set -euo pipefail
step() { printf '\\n\\033[1m%s\\033[0m\\n' "$*"; }

OC="\${OPENCLAW:-openclaw}"
command -v "$OC" >/dev/null || OC="$HOME/.npm-global/bin/openclaw"
if ! command -v "$OC" >/dev/null; then
  if ! command -v npm >/dev/null; then
    echo "OpenClaw runs on Node.js, which is not on this computer. Install Node.js from https://nodejs.org, then run this command again."
    exit 1
  fi
  step "Installing OpenClaw ${TESTED_OPENCLAW} (free and open source)"
  npm install -g --save-exact openclaw@${TESTED_OPENCLAW} || { echo "npm could not install OpenClaw. See https://docs.openclaw.ai/install, then run this command again."; exit 1; }
  OC="$(command -v openclaw || echo "$(npm prefix -g)/bin/openclaw")"
fi
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js was not found. Install it from https://nodejs.org, then run this command again."; exit 1; }

step "Installing Echo Helper"
DIR="$HOME/.openclaw-${PROFILE}/echo-helper"
mkdir -p "$DIR"
printf '%s' ${q(helperSource || '')} > "$DIR/echo-helper.mjs"
{
  echo '#!/bin/bash'
  echo "export PATH=\\"$(dirname "$NODE"):$(dirname "$OC"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin\\""
  echo "export OPENCLAW=\\"$OC\\""
  echo "exec \\"$NODE\\" \\"$DIR/echo-helper.mjs\\" \\"\\$@\\""
} > "$DIR/echo-helper"
chmod 755 "$DIR/echo-helper"
MANIFEST=${q(manifest)}
MANIFEST="\${MANIFEST/__PATH__/$DIR/echo-helper}"
installed=0
for browser in ${BROWSER_DIRS.map(d => `"$HOME/${d}"`).join(' ')}; do
  if [ -d "$browser" ]; then
    mkdir -p "$browser/NativeMessagingHosts"
    printf '%s' "$MANIFEST" > "$browser/NativeMessagingHosts/${HELPER_HOST}.json"
    installed=1
  fi
done
[ "$installed" = 1 ] || { echo "No Chrome, Chromium, Brave or Edge profile was found on this computer."; exit 1; }
step "Done. Go back to Chrome and press Turn on."
`;
}

/** The one-time install as one line to paste into a terminal. */
export function helperInstallCommand(extensionId: string, echoVersion: string): Promise<string> {
  return setupCommand(helperInstallScript(extensionId, echoVersion));
}
