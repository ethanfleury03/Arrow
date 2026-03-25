const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

(function main() {
  cp.execSync('node scripts/config-audit.js', {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env }
  });

  const jsonPath = path.join(DIST, 'CONFIG_AUDIT.json');
  const mdPath = path.join(DIST, 'CONFIG_AUDIT.md');

  assert.ok(fs.existsSync(jsonPath), 'CONFIG_AUDIT.json missing');
  assert.ok(fs.existsSync(mdPath), 'CONFIG_AUDIT.md missing');

  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  assert.strictEqual(report.file, 'config.template.json');
  assert.strictEqual(report.checkCount, 12);
  assert.strictEqual(report.passCount, 12);
  assert.strictEqual(report.allPass, true);
  assert.strictEqual(Array.isArray(report.results), true);
  assert.strictEqual(report.results.length, 12);
  assert.strictEqual(report.results.every(item => item.pass === true), true);

  console.log('PASS config audit deterministic artifact check');
})();
