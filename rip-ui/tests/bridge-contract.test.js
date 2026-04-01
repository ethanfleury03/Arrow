const assert = require('node:assert/strict');
const { createBridgeContract } = require('../electron/bridge-contract');
const { createRipBackend, RipBackendError, JobStatus } = require('../electron/rip-backend');

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

async function run() {
  const backend = createRipBackend({ mode: 'bridge-http', logger: silentLogger });
  const contract = createBridgeContract({ backend, logger: silentLogger });

  const runtime = await contract.getRuntimeConfig();
  assert.equal(typeof runtime.sessionId, 'string');
  assert.equal(typeof runtime.mode, 'string');
  console.log('  ✓ getRuntimeConfig returns session');

  await assert.rejects(
    () => contract.getStatus(null, {}),
    error => error.bridgeError && error.bridgeError.code === 'BRIDGE_UNAVAILABLE'
  );
  console.log('  ✓ getStatus throws bridgeError when bridge not running');

  await assert.rejects(
    () => contract.runCommand(null, {}),
    error => error.bridgeError != null
  );
  console.log('  ✓ runCommand rejects empty payload');

  await assert.rejects(
    () => contract.runCommand(null, { command: 'prepare', config: { host: '127.0.0.1', commandPort: 13001 } }),
    error => error.bridgeError != null
  );
  console.log('  ✓ runCommand propagates bridge error for valid command when bridge down');

  const audit = await contract.appendAudit(null, { type: 'test', note: 'contract test' });
  assert.equal(audit.ok, true);
  console.log('  ✓ appendAudit succeeds locally');

  const badEndpoint = await contract.testEndpoint(null, { host: '', port: 0 });
  assert.equal(badEndpoint.ok, false);
  assert.match(badEndpoint.message, /invalid/i);
  console.log('  ✓ testEndpoint rejects invalid endpoint');

  const unavailable = createBridgeContract({
    backend: createRipBackend({ mode: 'unsupported-mode', logger: silentLogger }),
    logger: silentLogger
  });
  await assert.rejects(
    () => unavailable.getStatus(null, {}),
    error => error.bridgeError && /BRIDGE_UNAVAILABLE/.test(error.bridgeError.code)
  );
  console.log('  ✓ unsupported mode yields BRIDGE_UNAVAILABLE');

  // Test degraded success for sendQueuedJob
  const mockBackendSend = {
    ...backend,
    sendQueuedJob: async () => {
      const error = new RipBackendError('BRIDGE_UNAVAILABLE', 'This operation was aborted');
      throw error;
    },
    getJobStatus: async (jobId) => {
      if (jobId === 'aborted-but-completed-send') {
        return JobStatus.COMPLETED;
      }
      return JobStatus.FAILED;
    }
  };
  const degradedSendContract = createBridgeContract({ backend: mockBackendSend, logger: silentLogger });

  const degradedSendResult = await degradedSendContract.sendQueuedJob(null, { jobId: 'aborted-but-completed-send' });
  assert.equal(degradedSendResult.ok, true);
  assert.match(degradedSendResult.message, /degraded success/i);
  assert.equal(degradedSendResult.status, JobStatus.COMPLETED);
  console.log('  ✓ sendQueuedJob reports degraded success when UI aborts but backend completes');

  await assert.rejects(
    () => degradedSendContract.sendQueuedJob(null, { jobId: 'aborted-but-failed-send' }),
    error => error.bridgeError && error.bridgeError.message === 'This operation was aborted',
    'sendQueuedJob still rejects for aborted but truly failed jobs'
  );
  console.log('  ✓ sendQueuedJob rejects for aborted but truly failed jobs');

  // Test degraded success for submitJob
  const mockBackendSubmit = {
    ...backend,
    submitJob: async () => {
      const error = new RipBackendError('BRIDGE_UNAVAILABLE', 'This operation was aborted');
      throw error;
    },
    getJobStatus: async (jobId) => {
      if (jobId === 'aborted-but-completed-submit') {
        return JobStatus.COMPLETED;
      }
      return JobStatus.FAILED;
    }
  };
  const degradedSubmitContract = createBridgeContract({ backend: mockBackendSubmit, logger: silentLogger });

  const degradedSubmitResult = await degradedSubmitContract.submitJob(null, { jobId: 'aborted-but-completed-submit' });
  assert.equal(degradedSubmitResult.ok, true);
  assert.match(degradedSubmitResult.message, /degraded success/i);
  assert.equal(degradedSubmitResult.status, JobStatus.COMPLETED);
  console.log('  ✓ submitJob reports degraded success when UI aborts but backend completes');

  await assert.rejects(
    () => degradedSubmitContract.submitJob(null, { jobId: 'aborted-but-failed-submit' }),
    error => error.bridgeError && error.bridgeError.message === 'This operation was aborted',
    'submitJob still rejects for aborted but truly failed jobs'
  );
  console.log('  ✓ submitJob rejects for aborted but truly failed jobs');

  console.log('bridge-contract.test: PASS');
}

run().catch(error => {
  console.error('bridge-contract.test: FAIL');
  console.error(error);
  process.exit(1);
});
