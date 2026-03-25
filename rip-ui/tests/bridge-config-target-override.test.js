const assert = require('node:assert/strict');
const { loadBridgeConfig } = require('../bridge/config');

function run() {
  const defaults = loadBridgeConfig({});
  assert.equal(defaults.memjet.host, '192.168.111.1');
  assert.equal(defaults.memjet.commandPort, 13002);
  assert.equal(defaults.memjet.eventPort, 9231);
  assert.equal(defaults.memjet.dataPort, 13001);

  const legacy = loadBridgeConfig({
    MEMJET_HOST: '10.0.0.2',
    MEMJET_COMMAND_PORT: '13020',
    MEMJET_EVENT_PORT: '13021',
    MEMJET_DATA_PORT: '13022'
  });
  assert.equal(legacy.memjet.host, '10.0.0.2');
  assert.equal(legacy.memjet.commandPort, 13020);
  assert.equal(legacy.memjet.eventPort, 13021);
  assert.equal(legacy.memjet.dataPort, 13022);

  const forced = loadBridgeConfig({
    MEMJET_HOST: '10.0.0.2',
    MEMJET_COMMAND_PORT: '13020',
    MEMJET_EVENT_PORT: '13021',
    MEMJET_DATA_PORT: '13022',
    MEMJET_TARGET_HOST: '192.168.50.10',
    MEMJET_TARGET_COMMAND_PORT: '14002',
    MEMJET_TARGET_EVENT_PORT: '14003',
    MEMJET_TARGET_DATA_PORT: '14004'
  });
  assert.equal(forced.memjet.host, '192.168.50.10');
  assert.equal(forced.memjet.commandPort, 14002);
  assert.equal(forced.memjet.eventPort, 14003);
  assert.equal(forced.memjet.dataPort, 14004);

  console.log('bridge-config-target-override.test: PASS');
}

try {
  run();
} catch (error) {
  console.error('bridge-config-target-override.test: FAIL');
  console.error(error);
  process.exit(1);
}
