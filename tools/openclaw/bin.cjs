const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Locate OpenClaw without assuming one npm prefix or operating system. */
function findOpenClaw(explicit) {
  for (const candidate of [explicit, process.env.ECHO_OPENCLAW_BIN, process.env.OPENCLAW]) {
    if (candidate && fs.existsSync(candidate)) return path.resolve(candidate);
  }
  try {
    const fromPath = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['openclaw'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/)[0];
    if (fromPath && fs.existsSync(fromPath)) return fromPath;
  } catch { /* try common user-level install locations below */ }
  const candidates = [
    path.join(os.homedir(), '.npm-global/bin/openclaw'),
    path.join(os.homedir(), '.local/bin/openclaw'),
  ];
  const found = candidates.find(fs.existsSync);
  if (found) return found;
  throw new Error('OpenClaw was not found. Install it or set ECHO_OPENCLAW_BIN.');
}

module.exports = { findOpenClaw };
