const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const SNAPSHOT = path.join(ROOT, 'tests', 'snapshots', 'hookup-acceptance.json');
const CHECKLIST = path.join(ROOT, 'HOOKUP_CHECKLIST.md');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function evaluate(snapshot) {
  const checks = [
    { key: 'bridgeSourceLive', pass: snapshot.source === 'live' },
    { key: 'pollingRunning', pass: snapshot.running === true },
    { key: 'engineStatusPresent', pass: typeof snapshot.engineState === 'string' && snapshot.engineState.length > 0 },
    { key: 'endpointCommandOk', pass: String(snapshot.connectionTests.command || '').startsWith('OK ') },
    { key: 'endpointEventOk', pass: String(snapshot.connectionTests.event || '').startsWith('OK ') },
    { key: 'endpointDataOk', pass: String(snapshot.connectionTests.data || '').startsWith('OK ') },
    { key: 'guardrailFeedbackVisible', pass: typeof snapshot.commandError === 'string' }
  ];

  return {
    generatedAt: '2026-03-13T14:00:00.000Z',
    allPass: checks.every(c => c.pass),
    checks,
    snapshot
  };
}

function countChecklistItems(markdown) {
  const lines = markdown.split(/\r?\n/).filter(line => line.trim().startsWith('- ['));
  return lines.length;
}

function writeMarkdown(report, checklistCount) {
  const lines = [];
  lines.push('# HOOKUP REPORT');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- allPass: ${report.allPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- checklistItems: ${checklistCount}`);
  lines.push('');
  lines.push('## Deterministic checks');
  for (const c of report.checks) {
    lines.push(`- ${c.pass ? '✅' : '❌'} ${c.key}`);
  }
  lines.push('');
  lines.push('## Snapshot');
  lines.push('```json');
  lines.push(JSON.stringify(report.snapshot, null, 2));
  lines.push('```');
  return lines.join('\n');
}

function main() {
  ensureDir(DIST);
  const snapshot = readJson(SNAPSHOT);
  const checklistText = fs.readFileSync(CHECKLIST, 'utf8');
  const checklistCount = countChecklistItems(checklistText);
  const report = evaluate(snapshot);

  const reportJsonPath = path.join(DIST, 'HOOKUP_REPORT.json');
  const reportMdPath = path.join(DIST, 'HOOKUP_REPORT.md');

  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(reportMdPath, writeMarkdown(report, checklistCount));

  console.log(`PASS hookup report -> ${path.relative(ROOT, reportJsonPath)} + ${path.relative(ROOT, reportMdPath)}`);
}

main();
