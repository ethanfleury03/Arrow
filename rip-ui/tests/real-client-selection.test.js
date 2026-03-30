const assert = require('node:assert/strict');
const { selectBackendCandidates, loadArrowPesDefaults } = require('../bridge/real-client-factory.local');

function run() {
  const autoNoSsh = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'auto' });
  assert.equal(autoNoSsh.requestedBackend, 'auto');
  assert.deepEqual(autoNoSsh.candidates, ['local']);

  const autoWithSsh = selectBackendCandidates({
    MEMJET_REAL_BACKEND: 'auto',
    MEMJET_SSH_HOST: '10.0.0.2',
    MEMJET_SSH_USER: 'arrow',
    MEMJET_SSH_REMOTE_CMD_TEMPLATE: '/usr/local/bin/pesctl --op {operation}'
  });
  assert.equal(autoWithSsh.requestedBackend, 'auto');
  assert.deepEqual(autoWithSsh.candidates, ['ssh', 'local']);

  const defaultSsh = selectBackendCandidates({});
  assert.equal(defaultSsh.requestedBackend, 'ssh');
  assert.deepEqual(defaultSsh.candidates, ['ssh']);

  const explicitLocal = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'local' });
  assert.equal(explicitLocal.requestedBackend, 'local');
  assert.deepEqual(explicitLocal.candidates, ['local']);

  const explicitSsh = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'ssh' });
  assert.equal(explicitSsh.requestedBackend, 'ssh');
  assert.deepEqual(explicitSsh.candidates, ['ssh']);

  testPesDefaultsFromEnv();
  testNoHardcodedCredentials();

  console.log('real-client-selection.test: PASS');
}

function testPesDefaultsFromEnv() {
  const defaults = loadArrowPesDefaults();
  assert.equal(typeof defaults.host, 'string');
  assert.ok(defaults.host.length > 0, 'PES host must resolve to a non-empty string');
  assert.equal(typeof defaults.commandPort, 'number');
  assert.equal(typeof defaults.sshHostKeyFingerprint, 'string');
  console.log('  ✓ testPesDefaultsFromEnv');
}

function testNoHardcodedCredentials() {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'real-client-factory.local.js'), 'utf8');
  const passwordPatterns = [
    /sshPassword\s*=\s*['"][^'"]+['"]/,
    /sshUser\s*=\s*['"]root['"]/
  ];
  for (const pattern of passwordPatterns) {
    assert.equal(
      pattern.test(src),
      false,
      `Source must not contain hardcoded credential pattern: ${pattern}`
    );
  }
  console.log('  ✓ testNoHardcodedCredentials');
}

run();
