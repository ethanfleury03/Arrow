const assert = require('node:assert/strict');
const { createBridgeServer } = require('../bridge/server');

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function run() {
  const calls = [];
  const adapter = {
    async checkConnectivity() {
      return {
        ok: true,
        connected: true,
        degraded: false,
        details: { queueLength: 0, productInfo: { output: '{}' } },
        lastUpdate: new Date().toISOString()
      };
    },
    async startMovingPrintheads({ printUnits, position }) {
      calls.push({ method: 'startMovingPrintheads', printUnits, position });
      if (position === 'print') {
        return { ok: true, printUnits, position, simulated: true, reason: 'shim response for test' };
      }
      return { ok: true, printUnits, position };
    }
  };

  const bridge = createBridgeServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'error',
      memjet: { mode: 'stub', protocol: 'thrift-compact' },
      dataDir: '/tmp/rip-head-controls-bridge-test'
    },
    adapter
  });

  await bridge.start();
  const { port } = bridge.server.address();
  const base = `http://127.0.0.1:${port}`;

  const cap = await postJson(`${base}/api/device/run-command`, { command: 'head_cap' });
  assert.equal(cap.status, 200);
  assert.equal(cap.body.accepted, true);
  assert.equal(cap.body.result.position, 'capped');
  assert.deepEqual(cap.body.result.printUnits, []);

  const raise = await postJson(`${base}/api/device/run-command`, { command: 'head_raise' });
  assert.equal(raise.status, 200);
  assert.equal(raise.body.accepted, true);
  assert.equal(raise.body.result.position, 'raised');
  assert.deepEqual(raise.body.result.printUnits, []);

  const print = await postJson(`${base}/api/device/run-command`, { command: 'head_print' });
  assert.equal(print.status, 409);
  assert.equal(print.body.accepted, false);
  assert.equal(print.body.error, 'simulated_response_rejected');
  assert.equal(print.body.result.position, 'print');
  assert.deepEqual(print.body.result.printUnits, []);
  assert.equal(print.body.result.simulated, true);

  assert.deepEqual(calls, [
    { method: 'startMovingPrintheads', printUnits: [], position: 'capped' },
    { method: 'startMovingPrintheads', printUnits: [], position: 'raised' },
    { method: 'startMovingPrintheads', printUnits: [], position: 'print' }
  ]);

  await bridge.stop();
  console.log('head-controls-bridge.test: PASS');
}

run().catch(async error => {
  console.error('head-controls-bridge.test: FAIL');
  console.error(error);
  process.exit(1);
});
