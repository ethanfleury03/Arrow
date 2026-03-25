const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SNAPSHOT = path.join(ROOT, 'tests', 'snapshots', 'scenario-matrix.json');

const outcomes = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

const report = {
  generatedAt: '2026-03-13T00:00:00.000Z',
  mode: 'offline-deterministic',
  scenarioCount: outcomes.length,
  passCount: outcomes.filter(x => x.outcome.result === 'PASS').length,
  failCount: outcomes.filter(x => x.outcome.result !== 'PASS').length,
  outcomes
};

const summary = [
  '# Scenario Matrix Summary',
  '',
  '- Generated: 2026-03-13T00:00:00.000Z',
  `- Total scenarios: ${report.scenarioCount}`,
  `- PASS: ${report.passCount}`,
  `- FAIL: ${report.failCount}`,
  '',
  '## Outcomes',
  ...outcomes.map(o => `- ${o.id}: ${o.outcome.result}${o.outcome.faultCode ? ` (${o.outcome.faultCode})` : ''}`),
  ''
].join('\n');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'SCENARIO_REPORT.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(DIST, 'SCENARIO_SUMMARY.md'), summary);

console.log('PASS scenario report generated');
