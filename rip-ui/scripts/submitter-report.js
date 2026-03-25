#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function toMd(report) {
  const lines = [];
  lines.push('# Submitter Report');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- spoolRoot: ${report.spoolRoot}`);
  lines.push(`- totalJobs: ${report.totalJobs}`);
  lines.push(`- pass: ${report.pass}`);
  lines.push('');
  lines.push('## Jobs');
  lines.push('');
  if (!report.jobs.length) {
    lines.push('- (none)');
  } else {
    report.jobs.forEach(job => {
      lines.push(`- ${job.jobId}: ${job.valid ? 'VALID' : 'INVALID'} (${job.mode || 'unknown'})`);
    });
  }
  lines.push('');
  return lines.join('\n');
}

function generate({ spoolRoot, outDir }) {
  const jobs = [];

  if (exists(spoolRoot)) {
    const dirs = fs.readdirSync(spoolRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();

    for (const dir of dirs) {
      const jobDir = path.join(spoolRoot, dir);
      const reqPath = path.join(jobDir, 'submit-request.json');
      const planPath = path.join(jobDir, 'submit-plan.json');
      const receiptPath = path.join(jobDir, 'receipt.json');

      const hasAll = exists(reqPath) && exists(planPath) && exists(receiptPath);
      const job = {
        jobId: dir,
        valid: false,
        mode: null,
        files: {
          request: exists(reqPath),
          plan: exists(planPath),
          receipt: exists(receiptPath)
        }
      };

      if (hasAll) {
        try {
          const req = readJson(reqPath);
          const plan = readJson(planPath);
          const receipt = readJson(receiptPath);
          job.mode = receipt?.mode || null;
          job.valid = req?.jobId === dir && typeof plan?.tool === 'string' && !!receipt?.contentHash;
        } catch {
          job.valid = false;
        }
      }

      jobs.push(job);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    spoolRoot,
    totalJobs: jobs.length,
    pass: jobs.every(j => j.valid),
    jobs
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'SUBMITTER_REPORT.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'SUBMITTER_REPORT.md'), toMd(report));

  return report;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const spoolRoot = process.env.RIP_SPOOL_OUT_DIR
    ? path.resolve(process.env.RIP_SPOOL_OUT_DIR)
    : path.join(root, 'dist', 'spool');
  const outDir = path.join(root, 'dist');
  const report = generate({ spoolRoot, outDir });
  process.stdout.write(JSON.stringify({ ok: true, totalJobs: report.totalJobs, pass: report.pass }));
}

module.exports = { generate };
