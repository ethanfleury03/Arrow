#!/usr/bin/env node
/* deterministic project lint: no network, no randomness */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'src/index.html',
  'src/styles.css',
  'src/app.js',
  'README.md',
  'BUILD_NOTES.md',
  'HOOKUP_CHECKLIST.md',
  'config.template.json'
];

function fail(msg) {
  console.error(`LINT_FAIL: ${msg}`);
  process.exitCode = 1;
}

for (const rel of requiredFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) fail(`missing required file: ${rel}`);
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (!/\.(md|json|js|html|css|ps1|sh|yml)$/i.test(rel)) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (/\t/.test(content)) fail(`${rel} contains tab characters`);
  if (/\r\n/.test(content)) fail(`${rel} contains CRLF; expected LF`);
}

if (!process.exitCode) {
  console.log('LINT_OK: deterministic lint checks passed');
}
