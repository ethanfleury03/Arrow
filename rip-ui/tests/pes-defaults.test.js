const assert = require('node:assert/strict');
const {
  DEFAULT_PES_HOST, DEFAULT_COMMAND_PORT, DEFAULT_EVENT_PORT, DEFAULT_DATA_PORT,
  loadPesDefaults
} = require('../bridge/pes-defaults');

function testConstants() {
  assert.equal(DEFAULT_PES_HOST, '192.168.111.1');
  assert.equal(DEFAULT_COMMAND_PORT, 13001);
  assert.equal(DEFAULT_EVENT_PORT, 9231);
  assert.equal(DEFAULT_DATA_PORT, 13001);
  console.log('  ✓ constants');
}

function testLoadDefaultsNoEnv() {
  const d = loadPesDefaults({});
  assert.equal(d.host, DEFAULT_PES_HOST);
  assert.equal(d.commandPort, DEFAULT_COMMAND_PORT);
  assert.equal(d.eventPort, DEFAULT_EVENT_PORT);
  assert.equal(d.dataPort, DEFAULT_DATA_PORT);
  assert.equal(d.sshHostKeyFingerprint, '');
  console.log('  ✓ loadPesDefaults with empty env');
}

function testEnvOverrides() {
  const env = {
    ARROW_PES_HOST: '10.0.0.1',
    ARROW_PES_COMMAND_PORT: '14001',
    ARROW_PES_EVENT_PORT: '14002',
    ARROW_PES_DATA_PORT: '14003',
    ARROW_PES_SSH_HOST_KEY: 'sha256:abc'
  };
  const d = loadPesDefaults(env);
  assert.equal(d.host, '10.0.0.1');
  assert.equal(d.commandPort, 14001);
  assert.equal(d.eventPort, 14002);
  assert.equal(d.dataPort, 14003);
  assert.equal(d.sshHostKeyFingerprint, 'sha256:abc');
  console.log('  ✓ ARROW_PES_* env overrides');
}

function testMemjetTargetFallback() {
  const env = {
    MEMJET_TARGET_HOST: '10.0.0.2',
    MEMJET_TARGET_COMMAND_PORT: '15001',
    MEMJET_TARGET_EVENT_PORT: '15002',
    MEMJET_TARGET_DATA_PORT: '15003'
  };
  const d = loadPesDefaults(env);
  assert.equal(d.host, '10.0.0.2');
  assert.equal(d.commandPort, 15001);
  assert.equal(d.eventPort, 15002);
  assert.equal(d.dataPort, 15003);
  console.log('  ✓ MEMJET_TARGET_* fallback');
}

function testArrowPesWinsOverMemjetTarget() {
  const env = {
    ARROW_PES_HOST: '10.0.0.1',
    MEMJET_TARGET_HOST: '10.0.0.2'
  };
  const d = loadPesDefaults(env);
  assert.equal(d.host, '10.0.0.1', 'ARROW_PES_HOST should take priority');
  console.log('  ✓ ARROW_PES_* wins over MEMJET_TARGET_*');
}

function testInvalidPortFallback() {
  const d = loadPesDefaults({ ARROW_PES_COMMAND_PORT: 'not-a-number' });
  assert.equal(d.commandPort, DEFAULT_COMMAND_PORT, 'invalid port falls back to default');
  console.log('  ✓ invalid port falls back to default');
}

function testFrozen() {
  const d = loadPesDefaults({});
  assert.ok(Object.isFrozen(d), 'returned object must be frozen');
  console.log('  ✓ returned object is frozen');
}

function testConsistencyWithBridgeConfig() {
  const { loadBridgeConfig } = require('../bridge/config');
  const cfg = loadBridgeConfig({});
  assert.equal(cfg.memjet.host, DEFAULT_PES_HOST, 'bridge config defaults must match pes-defaults host');
  assert.equal(cfg.memjet.commandPort, DEFAULT_COMMAND_PORT, 'bridge config defaults must match pes-defaults commandPort');
  assert.equal(cfg.memjet.eventPort, DEFAULT_EVENT_PORT, 'bridge config defaults must match pes-defaults eventPort');
  assert.equal(cfg.memjet.dataPort, DEFAULT_DATA_PORT, 'bridge config defaults must match pes-defaults dataPort');
  console.log('  ✓ bridge config defaults match pes-defaults');
}

function testConsistencyWithRuntimeConfig() {
  const { loadRuntimeConfig } = require('../electron/runtime-config');
  const rc = loadRuntimeConfig({ env: {} });
  assert.equal(rc.host, DEFAULT_PES_HOST, 'runtime config defaults must match pes-defaults host');
  assert.equal(rc.commandPort, DEFAULT_COMMAND_PORT, 'runtime config defaults must match pes-defaults commandPort');
  assert.equal(rc.eventPort, DEFAULT_EVENT_PORT, 'runtime config defaults must match pes-defaults eventPort');
  assert.equal(rc.dataPort, DEFAULT_DATA_PORT, 'runtime config defaults must match pes-defaults dataPort');
  console.log('  ✓ runtime config defaults match pes-defaults');
}

function run() {
  testConstants();
  testLoadDefaultsNoEnv();
  testEnvOverrides();
  testMemjetTargetFallback();
  testArrowPesWinsOverMemjetTarget();
  testInvalidPortFallback();
  testFrozen();
  testConsistencyWithBridgeConfig();
  testConsistencyWithRuntimeConfig();
  console.log('pes-defaults.test: PASS');
}

try {
  run();
} catch (error) {
  console.error('pes-defaults.test: FAIL');
  console.error(error);
  process.exit(1);
}
