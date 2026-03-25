const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_JSON = path.join(ROOT, 'dist', 'HANDOFF_BUNDLE.json');

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'handoff-bundle.js')], {
  cwd: ROOT,
  stdio: 'pipe'
});

const report = JSON.parse(fs.readFileSync(HANDOFF_JSON, 'utf8'));

assert.strictEqual(report.artifact, 'HANDOFF_BUNDLE');
assert.strictEqual(report.mode, 'offline-deterministic');
assert.strictEqual(report.generatedAt, '2026-03-13T00:00:00.000Z');
assert.strictEqual(report.gates.preflightPass, true);
assert.strictEqual(report.gates.scenarioPass, true);
assert.strictEqual(report.gates.manifestPass, true);
assert.strictEqual(report.gates.runbookCoveragePass, true);
assert.strictEqual(report.allPass, true);
assert.ok(report.summary.scenariosTotal >= 3);

console.log('PASS handoff-bundle deterministic checks');
