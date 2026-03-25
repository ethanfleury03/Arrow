#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

const requiredArtifacts = [
  'src/index.html',
  'src/app.js',
  'src/styles.css',
  'dist/RIP-UI-Prototype-Setup.exe',
  'scripts/build-windows-placeholder.ps1',
  'BUILD_NOTES.md',
  'HOOKUP_CHECKLIST.md',
  'config.template.json',
  'README.md'
];

function sha256ForFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const entries = requiredArtifacts
  .map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const exists = fs.existsSync(absolutePath);
    return {
      path: relativePath,
      exists,
      sizeBytes: exists ? fs.statSync(absolutePath).size : 0,
      sha256: exists ? sha256ForFile(absolutePath) : null
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const allPresent = entries.every((e) => e.exists);
const generatedAt = new Date('2026-03-13T00:00:00.000Z').toISOString();

const report = {
  milestone: 'M9',
  deterministic: true,
  generatedAt,
  allPresent,
  entries
};

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const jsonPath = path.join(distDir, 'RELEASE_MANIFEST.json');
const mdPath = path.join(distDir, 'RELEASE_MANIFEST.md');

fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

const lines = [
  '# Release Manifest',
  '',
  `- Milestone: ${report.milestone}`,
  `- Deterministic: ${report.deterministic}`,
  `- All required artifacts present: ${report.allPresent ? 'YES' : 'NO'}`,
  `- Generated At (fixed): ${report.generatedAt}`,
  '',
  '| Artifact | Exists | Size (bytes) | SHA-256 |',
  '|---|---:|---:|---|'
];

for (const entry of entries) {
  lines.push(`| ${entry.path} | ${entry.exists ? 'yes' : 'no'} | ${entry.sizeBytes} | ${entry.sha256 || '-'} |`);
}

fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf8');

console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, mdPath)}`);
if (!allPresent) {
  process.exitCode = 1;
}
