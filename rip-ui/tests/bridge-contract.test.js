const assert = require('node:assert/strict');
const { createBridgeContract } = require('../electron/bridge-contract');
const { createRipBackend } = require('../electron/rip-backend');

async function run() {
  const liveLike = createBridgeContract({ backend: createRipBackend({ mode: 'simulator' }) });

  const runtime = await liveLike.getRuntimeConfig();
  assert.equal(typeof runtime.sessionId, 'string');

  const status = await liveLike.getStatus(null, {});
  assert.match(status.engineState, /OFF|READY|PRINTING|IDLE|UNKNOWN/);
  assert.match(status.source, /^electron-/);
  assert.equal(typeof status.timestamp, 'string');

  const runKnown = await liveLike.runCommand(null, { command: 'prepare' });
  assert.equal(runKnown.accepted, true);
  assert.equal(runKnown.command, 'prepare');

  await assert.rejects(
    () => liveLike.runCommand(null, {}),
    error => /supported/.test(error.message)
  );

  const submit = await liveLike.submitJob(null, {
    jobId: 'JOB-0001A',
    fileName: 'sample.pdf',
    config: { host: '127.0.0.1', dataPort: 13001 },
    settings: { fitMode: 'none' }
  });
  assert.equal(typeof submit.accepted, 'boolean');

  const audit = await liveLike.appendAudit(null, { type: 'test', note: 'bridge test' });
  assert.equal(audit.ok, true);

  const badEndpoint = await liveLike.testEndpoint(null, { host: '', port: 0 });
  assert.equal(badEndpoint.ok, false);
  assert.match(badEndpoint.message, /invalid/i);

  const notConfigured = createBridgeContract({ backend: createRipBackend({ mode: 'not-configured' }) });
  await assert.rejects(
    () => notConfigured.getStatus(null, { host: '127.0.0.1', port: 13002 }),
    error => /not configured/i.test(error.message)
  );

  await assert.rejects(
    () => notConfigured.runCommand(null, { command: 'start' }),
    error => /requires backend configuration/i.test(error.message)
  );

  console.log('bridge-contract.test: PASS');
}

run().catch(error => {
  console.error('bridge-contract.test: FAIL');
  console.error(error);
  process.exit(1);
});
