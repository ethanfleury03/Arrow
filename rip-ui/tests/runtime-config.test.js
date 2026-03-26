const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRuntimeConfig } = require('../electron/runtime-config');

function run() {
  const base = loadRuntimeConfig({ env: {} });
  assert.equal(base.operatorProfile, 'kareela-lab');
  assert.equal(base.backendMode, 'bridge-http');
  assert.equal(base.bridgeHost, '127.0.0.1');
  assert.equal(base.bridgePort, 8787);
  assert.equal(base.operatorUsername, 'unknown-operator');
  assert.equal(base.operatorBadgeId, 'unassigned');

  const envProfile = loadRuntimeConfig({ env: { RIP_OPERATOR_PROFILE: 'kareela-lab' } });
  assert.equal(envProfile.backendMode, 'bridge-http');
  assert.equal(envProfile.host, '192.168.111.1');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-config-'));
  const file = path.join(dir, 'runtime.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      defaults: { pollIntervalMs: 1900, operatorBadgeId: 'B-77' },
      profiles: { 'kareela-lab': { host: '10.0.0.5', commandPort: 13010, operatorUsername: 'ethan' } }
    }),
    'utf8'
  );

  const fromFile = loadRuntimeConfig({
    env: { RIP_OPERATOR_PROFILE: 'kareela-lab', RIP_UI_CONFIG_FILE: file, RIP_HOST: '10.1.1.2' }
  });
  assert.equal(fromFile.host, '10.1.1.2');
  assert.equal(fromFile.commandPort, 13010);
  assert.equal(fromFile.pollIntervalMs, 1900);
  assert.equal(fromFile.operatorUsername, 'ethan');
  assert.equal(fromFile.operatorBadgeId, 'B-77');

  const fromEnv = loadRuntimeConfig({
    env: {
      RIP_OPERATOR_PROFILE: 'kareela-lab',
      RIP_OPERATOR_USERNAME: 'operator-1',
      RIP_OPERATOR_BADGE_ID: 'A-12',
      RIP_OPERATOR_IDENTITY_SECRET: 'test-secret'
    }
  });
  assert.equal(fromEnv.operatorUsername, 'operator-1');
  assert.equal(fromEnv.operatorBadgeId, 'A-12');
  assert.equal(fromEnv.operatorIdentitySecret, 'test-secret');

  console.log('runtime-config.test: PASS');
}

try {
  run();
} catch (error) {
  console.error('runtime-config.test: FAIL');
  console.error(error);
  process.exit(1);
}
