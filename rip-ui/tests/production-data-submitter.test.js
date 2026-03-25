const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.resolve(__dirname, '..', 'scripts', 'production-data-submitter.js');

(function main() {
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-submitter-'));
  const payload = {
    jobId: 'JOB_PROD_1234',
    fileName: 'artwork.pdf',
    config: { host: '192.168.111.2', commandPort: 13002, jobDataPort: 13001 },
    settings: { copies: 2, repeats: 1, fitMode: 'fit' }
  };

  const run = spawnSync(bin, ['submit-job'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      RIP_SPOOL_OUT_DIR: spoolRoot
    }
  });

  assert.equal(run.status, 0);
  const result = JSON.parse(run.stdout || '{}');
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'submitted');
  assert.equal(result.mode, 'dry-run');
  assert.ok(result.spoolDir);

  const planPath = path.join(result.spoolDir, 'submit-plan.json');
  const receiptPath = path.join(result.spoolDir, 'receipt.json');
  assert.equal(fs.existsSync(planPath), true);
  assert.equal(fs.existsSync(receiptPath), true);

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assert.equal(plan.tool, 'gborcat');
  assert.deepEqual(plan.args.slice(0, 4), ['-h', '192.168.111.2', '-p', '13001']);

  fs.rmSync(spoolRoot, { recursive: true, force: true });
  console.log('production-data-submitter.test: PASS');
})();
