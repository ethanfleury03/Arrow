const assert = require('node:assert/strict');
const { createBridgeServer } = require('../bridge/server');
const { JobManager } = require('../bridge/job-manager');

async function testDeviceStatusDegradedAndPreflight() {
  const bridge = createBridgeServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'error',
      dataDir: '/tmp/rip-bridge-phase2-status',
      memjet: {
        mode: 'real',
        host: '127.0.0.1',
        commandPort: 65530,
        eventPort: 65531,
        dataPort: 65532,
        protocol: 'thrift-compact',
        transport: 'framed',
        connectTimeoutMs: 50,
        allowDataSubmission: false,
        enableRealCommands: false,
        enableRealStartPrint: false,
        dryRunRealSequence: true,
        clientFactoryPath: null
      }
    }
  });

  await bridge.start();
  const { port } = bridge.server.address();
  const base = `http://127.0.0.1:${port}`;

  const statusRes = await fetch(`${base}/api/device/status`);
  const status = await statusRes.json();
  assert.equal(statusRes.status, 200);
  assert.equal(status.connected, false);
  assert.equal(status.degraded, true);
  assert.equal(typeof status.details.diagnostics.commandReachable, 'boolean');
  assert.equal(typeof status.details.diagnostics.thriftLoadable, 'boolean');
  assert.equal(status.details.diagnostics.gates.enableRealCommands, false);
  assert.equal(status.details.diagnostics.operations.startPrinting.allowed, false);

  const preflightRes = await fetch(`${base}/api/device/preflight`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requireStartPrint: true })
  });
  const preflight = await preflightRes.json();
  assert.equal(preflightRes.status, 200);
  assert.equal(preflight.passed, false);
  assert.ok(preflight.checks.some(c => c.id === 'controlPlaneReady' && c.passed === false));
  assert.ok(preflight.checks.some(c => c.id === 'realCommandsGate' && c.passed === false));

  const created = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'PHASE2_GUARD', fileName: 'test.gbor', artifactPath: '/tmp/missing.gbor' })
  }).then(r => r.json());
  assert.equal(created.state, 'validated');

  const sendRes = await fetch(`${base}/api/jobs/PHASE2_GUARD/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ copies: 1 })
  });
  const send = await sendRes.json();
  assert.equal(sendRes.status, 503);
  assert.equal(send.error, 'adapter_unavailable');

  await bridge.stop();
}

async function testGateEnforcementAndDryRunBehavior() {
  const calls = [];
  const adapter = {
    async checkConnectivity() {
      return {
        ok: true,
        diagnostics: {
          gates: { dryRunRealSequence: true }
        }
      };
    },
    async preflightFirstPrint({ requireStartPrint }) {
      calls.push(`preflight:${requireStartPrint}`);
      return { passed: true, dryRun: true, checks: [], diagnostics: {} };
    },
    async clearQueue() { calls.push('clearQueue'); },
    async initialiseEngine() { calls.push('initialiseEngine'); },
    async prepareToPrint() { calls.push('prepareToPrint'); },
    async submitJobData() { calls.push('submitJobData'); },
    async startPrinting() { calls.push('startPrinting(simulated)'); return { ok: true, simulated: true }; },
    async finishPrinting() { calls.push('finishPrinting'); },
    async cancelJob() {}
  };

  const manager = new JobManager({
    adapter,
    logger: { info() {}, error() {} },
    emit() {},
    dataDir: '/tmp/rip-bridge-phase2-idempotency'
  });

  manager.createJob({ jobId: 'DRYRUN_OK', fileName: 'ok.gbor', artifactPath: __filename });
  const sent = await manager.sendJob('DRYRUN_OK', { copies: 1 });
  assert.equal(sent.state, 'completed');
  assert.deepStrictEqual(calls, [
    'preflight:false',
    'clearQueue',
    'initialiseEngine',
    'prepareToPrint',
    'submitJobData',
    'startPrinting(simulated)',
    'finishPrinting'
  ]);
}

async function testPreflightFailureBlocksSend() {
  const adapter = {
    async checkConnectivity() {
      return {
        ok: true,
        diagnostics: {
          gates: { dryRunRealSequence: false }
        }
      };
    },
    async preflightFirstPrint() {
      return {
        passed: false,
        dryRun: false,
        checks: [{ id: 'startPrintGate', required: true, passed: false, detail: 'Set RIP_BRIDGE_ENABLE_REAL_START_PRINT=true' }],
        diagnostics: { gates: { enableRealStartPrint: false } }
      };
    },
    async clearQueue() { throw new Error('should not run'); },
    async initialiseEngine() { throw new Error('should not run'); },
    async prepareToPrint() { throw new Error('should not run'); },
    async submitJobData() { throw new Error('should not run'); },
    async startPrinting() { throw new Error('should not run'); },
    async finishPrinting() { throw new Error('should not run'); },
    async cancelJob() {}
  };

  const manager = new JobManager({
    adapter,
    logger: { info() {}, error() {} },
    emit() {},
    dataDir: '/tmp/rip-bridge-phase2-preflight-fail'
  });

  manager.createJob({ jobId: 'PREFLIGHT_FAIL', fileName: 'ok.gbor', artifactPath: __filename });

  await assert.rejects(
    () => manager.sendJob('PREFLIGHT_FAIL', { copies: 1 }),
    error => /Preflight failed/i.test(error.message)
  );
}

async function run() {
  await testDeviceStatusDegradedAndPreflight();
  await testGateEnforcementAndDryRunBehavior();
  await testPreflightFailureBlocksSend();
  console.log('bridge-phase1.test: PASS');
}

run().catch(error => {
  console.error('bridge-phase1.test: FAIL');
  console.error(error);
  process.exit(1);
});
