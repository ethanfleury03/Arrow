const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function run(script, env = {}) {
  cp.execSync(`node ${script}`, {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, ...env }
  });
}

(function main() {
  const forcedTimestamp = '2026-03-13T14:31:00.000Z';
  run('scripts/ops-snapshot.js', { RIP_SNAPSHOT_TIMESTAMP: forcedTimestamp });

  const jsonPath = path.join(DIST, 'OPS_SNAPSHOT.json');
  const mdPath = path.join(DIST, 'OPS_SNAPSHOT.md');

  assert.ok(fs.existsSync(jsonPath), 'OPS_SNAPSHOT.json missing');
  assert.ok(fs.existsSync(mdPath), 'OPS_SNAPSHOT.md missing');

  const snapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  assert.strictEqual(snapshot.generatedAt, forcedTimestamp);
  assert.strictEqual(Array.isArray(snapshot.artifacts), true);
  assert.strictEqual(snapshot.artifacts.length, 7);
  assert.strictEqual(snapshot.allPass, true);
  assert.strictEqual(snapshot.artifacts.every(item => item.exists === true), true);

  console.log('PASS ops snapshot deterministic artifact check');
})();
