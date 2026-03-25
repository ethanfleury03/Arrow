const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generate } = require('../scripts/submitter-report');

(function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'submitter-report-'));
  const spoolRoot = path.join(tmp, 'spool');
  const outDir = path.join(tmp, 'out');
  const jobDir = path.join(spoolRoot, 'JOB_REPORT_001');

  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'submit-request.json'), JSON.stringify({ jobId: 'JOB_REPORT_001' }, null, 2));
  fs.writeFileSync(path.join(jobDir, 'submit-plan.json'), JSON.stringify({ tool: 'gborcat' }, null, 2));
  fs.writeFileSync(path.join(jobDir, 'receipt.json'), JSON.stringify({ mode: 'dry-run', contentHash: 'abc123' }, null, 2));

  const report = generate({ spoolRoot, outDir });

  assert.equal(report.totalJobs, 1);
  assert.equal(report.pass, true);
  assert.equal(report.jobs[0].jobId, 'JOB_REPORT_001');
  assert.equal(report.jobs[0].valid, true);

  assert.equal(fs.existsSync(path.join(outDir, 'SUBMITTER_REPORT.json')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'SUBMITTER_REPORT.md')), true);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('submitter-report.test: PASS');
})();
