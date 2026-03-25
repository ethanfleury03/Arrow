#!/usr/bin/env node
const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function fail(code, message, details = {}) {
  process.stdout.write(
    JSON.stringify({
      accepted: false,
      status: 'rejected',
      code,
      message,
      details,
      timestamp: nowIso()
    })
  );
  process.exit(0);
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

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch (error) {
    return fail('SUBMIT_BAD_JSON', `stdin must contain valid JSON: ${error.message}`);
  }

  const valid = validate(payload);
  if (!valid.ok) {
    return fail(valid.code, valid.message);
  }

  const contentHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  process.stdout.write(
    JSON.stringify({
      accepted: true,
      status: 'submitted',
      message: 'Mock data-plane submitter accepted payload (deterministic harness).',
      jobId: payload.jobId,
      contractVersion: '1.0.0',
      contentHash,
      timestamp: nowIso()
    })
  );
});
