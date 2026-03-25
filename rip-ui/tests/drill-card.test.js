const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CARD_JSON = path.join(ROOT, 'dist', 'DRILL_CARD.json');

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'drill-card.js')], {
  cwd: ROOT,
  stdio: 'pipe'
});

const card = JSON.parse(fs.readFileSync(CARD_JSON, 'utf8'));

assert.strictEqual(card.artifact, 'DRILL_CARD');
assert.strictEqual(card.mode, 'offline-deterministic');
assert.strictEqual(card.generatedAt, '2026-03-13T00:00:00.000Z');
assert.strictEqual(Array.isArray(card.drillSteps), true);
assert.strictEqual(card.drillSteps.length >= 3, true);
assert.strictEqual(Array.isArray(card.expectedFaultCodes), true);
assert.strictEqual(card.acceptance.scenarioMatrixCount, 6);

console.log('PASS drill-card deterministic checks');
