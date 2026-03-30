const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const bin = path.resolve(__dirname, '..', 'scripts', 'mock-data-submitter.js');

function run(payload) {
  return spawnSync(process.execPath, [bin, 'submit-job'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000
  });
}

function parse(stdout) {
  return JSON.parse(stdout || '{}');
}

(function main() {
  const bad = run({ jobId: 'x' });
  const badOut = parse(bad.stdout);
  assert.ok(bad.status === 0 || bad.status === null, `Expected exit 0 or null, got ${bad.status}`);
  assert.equal(badOut.accepted, false);
  assert.equal(badOut.code, 'SUBMIT_INVALID_JOB_ID');

  const ok = run({
    jobId: 'JOB_TEST_1234',
    fileName: 'artwork.pdf',
    config: { host: '127.0.0.1', commandPort: 13002 },
    settings: { fitMode: 'contain' }
  });
  const okOut = parse(ok.stdout);
  assert.equal(ok.status, 0);
  assert.equal(okOut.accepted, true);
  assert.equal(okOut.status, 'submitted');
  assert.equal(okOut.jobId, 'JOB_TEST_1234');
  assert.ok(okOut.contentHash);

  console.log('data-submitter-contract.test: PASS');
})();
