const assert = require('node:assert/strict');
const { createBridgeContract } = require('../electron/bridge-contract');
const { createRipBackend } = require('../electron/rip-backend');

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

  console.log('bridge-contract.test: PASS');
}

run().catch(error => {
  console.error('bridge-contract.test: FAIL');
  console.error(error);
  process.exit(1);
});
