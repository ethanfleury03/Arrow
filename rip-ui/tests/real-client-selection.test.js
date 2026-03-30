const assert = require('node:assert/strict');
const path = require('node:path');
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
  testSshKeyPathDefaults();
  testSshBatchModeEnforced();

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

function testSshKeyPathDefaults() {
  const fs = require('node:fs');
  const srcPath = path.join(__dirname, '..', 'bridge', 'real-client-factory.local.js');
  const src = fs.readFileSync(srcPath, 'utf8');

  // Verify hardcoded Windows key path for Arrow rig (exact path, no USERPROFILE)
  // In JS source, backslash is escaped as \, so the literal text is: C:\Users\Arrow\.ssh\id_ed25519
  assert.ok(
    src.includes('C:\\\\Users\\\\Arrow\\\\.ssh\\\\id_ed25519'),
    'Source must hardcode Windows SSH key path to C:\\Users\\Arrow\\.ssh\\id_ed25519 for deterministic behavior'
  );

  // Verify the path is NOT constructed using USERPROFILE
  assert.ok(
    !src.includes('env.USERPROFILE') && !src.includes('process.env.USERPROFILE'),
    'Source must NOT use USERPROFILE for SSH key path to avoid variability'
  );

  console.log('  ✓ testSshKeyPathDefaults');
}

function testSshBatchModeEnforced() {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'real-client-factory.local.js'), 'utf8');

  // Verify BatchMode=yes is used (not BatchMode=no)
  assert.ok(
    src.includes("'BatchMode=yes'"),
    'Source must enforce non-interactive SSH with BatchMode=yes'
  );

  // Verify BatchMode=no is NOT used
  assert.ok(
    !src.includes("'BatchMode=no'"),
    'Source must NOT use BatchMode=no which allows interactive prompts'
  );

  // Verify only publickey auth is preferred (no password/keyboard-interactive)
  assert.ok(
    src.includes("'PreferredAuthentications=publickey'"),
    'Source must use PreferredAuthentications=publickey for non-interactive auth'
  );

  console.log('  ✓ testSshBatchModeEnforced');
}

run();
