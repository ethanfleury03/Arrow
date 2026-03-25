const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const REQUIRED = [
  'PREFLIGHT_REPORT.json',
  'SCENARIO_REPORT.json',
  'RELEASE_MANIFEST.json',
  'CONTROL_RUNBOOK.json',
  'HANDOFF_BUNDLE.json',
  'DRILL_CARD.json',
  'HOOKUP_REPORT.json'
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function artifactStatus(name) {
  const file = path.join(DIST, name);
  if (!fs.existsSync(file)) {
    return { name, exists: false, pass: false, reason: 'missing' };
  }

  const data = readJson(file);
  const pass = evaluatePass(name, data);
  return {
    name,
    exists: true,
    pass,
    reason: pass ? 'ok' : 'failed-check'
  };
}

function evaluatePass(name, data) {
  if (name === 'RELEASE_MANIFEST.json') return data.allPresent === true;
  if (name === 'PREFLIGHT_REPORT.json') return data.summary?.overall === 'PASS';
  if (name === 'SCENARIO_REPORT.json') {
    return Number.isInteger(data.scenarioCount)
      && Number.isInteger(data.passCount)
      && Number.isInteger(data.failCount)
      && data.scenarioCount === data.passCount + data.failCount
      && Array.isArray(data.outcomes)
      && data.outcomes.length === data.scenarioCount;
  }
  if (name === 'CONTROL_RUNBOOK.json') return Array.isArray(data.scenarios) && data.scenarios.length >= 3;
  if (name === 'HANDOFF_BUNDLE.json') return data.allPass === true;
  if (name === 'DRILL_CARD.json') {
    return Array.isArray(data.drillSteps)
      && data.drillSteps.length >= 3
      && Array.isArray(data.expectedFaultCodes)
      && data.expectedFaultCodes.length >= 4;
  }
  if (name === 'HOOKUP_REPORT.json') return data.allPass === true;
  return false;
}

function resolveGeneratedAt() {
  const forced = process.env.RIP_SNAPSHOT_TIMESTAMP;
  if (typeof forced === 'string' && forced.trim()) {
    return forced.trim();
  }
  return new Date().toISOString();
}

function buildSnapshot(statuses) {
  return {
    generatedAt: resolveGeneratedAt(),
    allPass: statuses.every(s => s.pass),
    artifacts: statuses
  };
}

function toMarkdown(snapshot) {
  const lines = [];
  lines.push('# OPS SNAPSHOT');
  lines.push('');
  lines.push(`- generatedAt: ${snapshot.generatedAt}`);
  lines.push(`- allPass: ${snapshot.allPass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Artifact status');
  for (const item of snapshot.artifacts) {
    lines.push(`- ${item.pass ? '✅' : '❌'} ${item.name} (${item.reason})`);
  }
  return lines.join('\n');
}

function main() {
  const statuses = REQUIRED.map(artifactStatus);
  const snapshot = buildSnapshot(statuses);

  const jsonPath = path.join(DIST, 'OPS_SNAPSHOT.json');
  const mdPath = path.join(DIST, 'OPS_SNAPSHOT.md');

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(snapshot));

  console.log(`PASS ops snapshot -> ${path.relative(ROOT, jsonPath)} + ${path.relative(ROOT, mdPath)}`);
}

main();
