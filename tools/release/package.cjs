#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const outputDir = path.join(root, 'package for sharing');
const manifestFile = path.join(dist, 'manifest.json');

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestFile)) fail('dist/manifest.json is missing; run npm run build first.');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const required = ['background.js', 'content.js', 'content-ui.js', 'options.html', 'options.js', 'privacy.html', 'sidepanel.html', 'sidepanel.js'];
for (const file of required) if (!fs.existsSync(path.join(dist, file))) fail(`${file} is missing.`);

const iconPaths = Object.values(manifest.icons || {});
for (const icon of iconPaths) if (!fs.existsSync(path.join(dist, icon))) fail(`manifest icon ${icon} is missing.`);

const files = [];
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    else files.push(relative);
  }
}
walk(dist);
for (const file of files) {
  if (/\.map$|(^|\/)\.DS_Store$/.test(file)) fail(`forbidden generated file: ${file}`);
}
if (files.some(file => !/^[\x20-\x7e]+$/.test(file))) fail('archive contains a non-ASCII filename.');

if (process.argv.includes('--check')) {
  console.log(`Release check passed: ${files.length} files for ECHO ${manifest.version}.`);
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(outputDir, `Echo_Online_v${manifest.version}.zip`);
fs.rmSync(archive, { force: true });
const zipped = spawnSync('zip', ['-X', '-q', archive, ...files], { cwd: dist, encoding: 'utf8' });
if (zipped.status !== 0) fail(`zip failed: ${zipped.stderr || zipped.stdout || 'unknown error'}`);

const bytes = fs.readFileSync(archive);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
console.log(`Packaged ${path.relative(root, archive)} (${Math.round(bytes.length / 1024)} KiB)`);
console.log(`SHA-256 ${digest}`);
