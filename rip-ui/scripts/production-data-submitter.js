#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const CONTRACT_VERSION = '1.1.0';

function nowIso() {
  return new Date().toISOString();
}

function readJsonStdin() {
  const raw = fs.readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw || '{}');
  } catch (error) {
    return {
      __parseError: `stdin must contain valid JSON: ${error.message}`
    };
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function deterministicHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'SUBMIT_INVALID_PAYLOAD', message: 'Payload must be a JSON object.' };
  }

  const jobId = String(payload.jobId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId)) {
    return {
      ok: false,
      code: 'SUBMIT_INVALID_JOB_ID',
      message: 'jobId must be 8-64 chars: A-Z, a-z, 0-9, underscore, hyphen only.'
    };
  }

  if (!payload.fileName || typeof payload.fileName !== 'string') {
    return { ok: false, code: 'SUBMIT_INVALID_FILE_NAME', message: 'fileName is required and must be a string.' };
  }

  if (!payload.config || typeof payload.config !== 'object') {
    return { ok: false, code: 'SUBMIT_INVALID_CONFIG', message: 'config object is required.' };
  }

  if (!payload.settings || typeof payload.settings !== 'object') {
    return { ok: false, code: 'SUBMIT_INVALID_SETTINGS', message: 'settings object is required.' };
  }

  return { ok: true };
}

function out(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function reject(code, message, details = {}) {
  out({
    accepted: false,
    status: 'rejected',
    code,
    message,
    details,
    timestamp: nowIso()
  });
  process.exit(0);
}

function getSpoolRoot() {
  return process.env.RIP_SPOOL_OUT_DIR
    ? path.resolve(process.env.RIP_SPOOL_OUT_DIR)
    : path.resolve(__dirname, '..', 'dist', 'spool');
}

function buildPlan(payload) {
  const host = String(payload.config.host || '127.0.0.1');
  const jobDataPort = Number(payload.config.jobDataPort || 13001);
  const copies = Number(payload.settings.copies || 1);
  const repeats = Number(payload.settings.repeats || 1);

  return {
    host,
    jobDataPort,
    tool: process.env.RIP_GBORCAT_BIN || 'gborcat',
    args: ['-h', host, '-p', String(jobDataPort), '-c', String(copies), '-r', String(repeats), '-j', payload.jobId, '-v', payload.fileName]
  };
}

function runPlan(plan) {
  const child = spawnSync(plan.tool, plan.args, {
    encoding: 'utf8',
    timeout: Number(process.env.RIP_SUBMIT_TIMEOUT_MS || 15000)
  });

  return {
    status: child.status,
    signal: child.signal,
    stdout: (child.stdout || '').trim().slice(0, 2000),
    stderr: (child.stderr || '').trim().slice(0, 2000)
  };
}

(function main() {
  const action = process.argv[2];
  if (action !== 'submit-job') {
    return reject('SUBMIT_BAD_ACTION', 'Expected invocation: submit-job');
  }

  const payload = readJsonStdin();
  if (payload.__parseError) {
    return reject('SUBMIT_BAD_JSON', payload.__parseError);
  }

  const valid = validate(payload);
  if (!valid.ok) {
    return reject(valid.code, valid.message);
  }

  const spoolRoot = getSpoolRoot();
  const spoolDir = path.join(spoolRoot, payload.jobId);
  ensureDir(spoolDir);

  const plan = buildPlan(payload);
  const audit = {
    contractVersion: CONTRACT_VERSION,
    action: 'submit-job',
    mode: process.env.RIP_SUBMIT_EXECUTE === '1' ? 'execute' : 'dry-run',
    payload,
    plan,
    timestamp: nowIso()
  };

  const contentHash = deterministicHash({ payload, plan });
  const receipt = {
    ...audit,
    contentHash
  };

  fs.writeFileSync(path.join(spoolDir, 'submit-request.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(spoolDir, 'submit-plan.json'), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(spoolDir, 'receipt.json'), JSON.stringify(receipt, null, 2));

  if (process.env.RIP_SUBMIT_EXECUTE === '1') {
    const execution = runPlan(plan);
    fs.writeFileSync(path.join(spoolDir, 'execution.json'), JSON.stringify(execution, null, 2));

    if (execution.status !== 0) {
      return reject('SUBMIT_EXEC_FAILED', 'GBOR handoff command failed.', {
        spoolDir,
        ...execution
      });
    }

    return out({
      accepted: true,
      status: 'submitted',
      message: 'Production data submitter executed GBOR handoff command successfully.',
      jobId: payload.jobId,
      contractVersion: CONTRACT_VERSION,
      mode: 'execute',
      contentHash,
      spoolDir,
      timestamp: nowIso()
    });
  }

  return out({
    accepted: true,
    status: 'submitted',
    message: 'Production data submitter prepared deterministic GBOR handoff bundle (dry-run mode).',
    jobId: payload.jobId,
    contractVersion: CONTRACT_VERSION,
    mode: 'dry-run',
    contentHash,
    spoolDir,
    timestamp: nowIso()
  });
})();
