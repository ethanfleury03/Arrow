const assert = require('node:assert/strict');
const { runSshSelfCheck, buildSshArgs, buildSshSettings } = require('../bridge/real-client-factory.local');

function testBuildSshArgsStructure() {
  const settings = {
    sshHost: '192.168.111.1',
    sshUser: 'arrow',
    sshPort: 22,
    sshKeyPath: '/fake/key/path',
    defaultParams: { host: '192.168.111.1', commandPort: '13001', eventPort: '9231', dataPort: '13001' }
  };

  const args = buildSshArgs(settings);

  // Must be array
  assert.ok(Array.isArray(args), 'buildSshArgs must return an array');

  // Must start with -F and null device
  const expectedNullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  assert.equal(args[0], '-F', 'First arg must be -F');
  assert.equal(args[1], expectedNullDevice, 'Second arg must be null device');

  // Must include security options
  assert.ok(args.includes('BatchMode=yes'), 'Must include BatchMode=yes');
  assert.ok(args.includes('IdentitiesOnly=yes'), 'Must include IdentitiesOnly=yes');
  assert.ok(args.includes('PreferredAuthentications=publickey'), 'Must include PreferredAuthentications=publickey');
  assert.ok(args.includes('StrictHostKeyChecking=accept-new'), 'Must include StrictHostKeyChecking=accept-new');

  // Must include target
  const userHost = `${settings.sshUser}@${settings.sshHost}`;
  assert.ok(args.includes(userHost), `Must include target ${userHost}`);

  console.log('  ✓ testBuildSshArgsStructure');
}

function testBuildSshArgsWithKeyFile() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  // Create a temp file to test key file inclusion
  const tmpDir = os.tmpdir();
  const tmpKeyPath = path.join(tmpDir, `test_key_${Date.now()}.key`);

  try {
    fs.writeFileSync(tmpKeyPath, 'fake-key-data');

    const settings = {
      sshHost: '192.168.111.1',
      sshUser: 'arrow',
      sshPort: 22,
      sshKeyPath: tmpKeyPath,
      defaultParams: { host: '192.168.111.1', commandPort: '13001', eventPort: '9231', dataPort: '13001' }
    };

    const args = buildSshArgs(settings);

    // When key file exists, -i flag should be present
    const iIndex = args.indexOf('-i');
    assert.ok(iIndex !== -1, 'Must include -i flag when key file exists');
    assert.equal(args[iIndex + 1], tmpKeyPath, '-i must reference the key path');

  } finally {
    try { fs.unlinkSync(tmpKeyPath); } catch {}
  }

  console.log('  ✓ testBuildSshArgsWithKeyFile');
}

function testBuildSshArgsWithoutKeyFile() {
  const settings = {
    sshHost: '192.168.111.1',
    sshUser: 'arrow',
    sshPort: 22,
    sshKeyPath: '/nonexistent/key/path',
    defaultParams: { host: '192.168.111.1', commandPort: '13001', eventPort: '9231', dataPort: '13001' }
  };

  const args = buildSshArgs(settings);

  // When key file does not exist, -i flag should NOT be present
  const iIndex = args.indexOf('-i');
  assert.equal(iIndex, -1, 'Must NOT include -i flag when key file does not exist');

  console.log('  ✓ testBuildSshArgsWithoutKeyFile');
}

function testSshSettingsStructure() {
  // Test that buildSshSettings returns expected structure
  const settings = buildSshSettings({
    host: '192.168.111.1',
    commandPort: 13001,
    eventPort: 9231,
    dataPort: 13001
  });

  // Verify settings structure
  assert.ok(typeof settings === 'object', 'settings must be an object');
  assert.ok(typeof settings.backend === 'string', 'settings.backend must be a string');
  assert.ok(typeof settings.sshHost === 'string', 'settings.sshHost must be a string');
  assert.ok(typeof settings.sshUser === 'string', 'settings.sshUser must be a string');
  assert.ok(typeof settings.sshPort === 'number', 'settings.sshPort must be a number');
  assert.ok(typeof settings.sshBin === 'string', 'settings.sshBin must be a string');
  assert.ok(typeof settings.sshTimeoutMs === 'number', 'settings.sshTimeoutMs must be a number');
  assert.ok(typeof settings.cmdTemplate === 'string', 'settings.cmdTemplate must be a string');
  assert.ok(Array.isArray(settings.missing), 'settings.missing must be an array');
  assert.ok(typeof settings.defaultParams === 'object', 'settings.defaultParams must be an object');

  // Verify defaultParams structure
  assert.ok(typeof settings.defaultParams.host === 'string', 'defaultParams.host must be a string');
  assert.ok(typeof settings.defaultParams.commandPort === 'string', 'defaultParams.commandPort must be a string');
  assert.ok(typeof settings.defaultParams.eventPort === 'string', 'defaultParams.eventPort must be a string');
  assert.ok(typeof settings.defaultParams.dataPort === 'string', 'defaultParams.dataPort must be a string');

  console.log('  ✓ testSshSettingsStructure');
}

async function testSelfCheckReturnsResultShape() {
  // Create settings that will fail fast (no real SSH server)
  const settings = {
    sshHost: '192.168.111.254', // Unlikely to exist
    sshUser: 'arrow',
    sshPort: 22,
    sshKeyPath: '/nonexistent/key',
    sshBin: 'ssh',
    sshTimeoutMs: 1000,
    cmdTemplate: '/usr/local/bin/pesctl --op {operation}',
    missing: [],
    defaultParams: { host: '192.168.111.1', commandPort: '13001', eventPort: '9231', dataPort: '13001' }
  };

  const logger = {
    info: () => {},
    error: () => {},
    warn: () => {}
  };

  const result = await runSshSelfCheck(settings, logger);

  // Result must have expected shape
  assert.ok(typeof result === 'object', 'Result must be an object');
  assert.ok(typeof result.ok === 'boolean', 'Result must have ok boolean');

  // When check fails, should have category and reason
  if (!result.ok) {
    assert.ok(typeof result.category === 'string', 'Failed result must have category string');
    assert.ok(typeof result.reason === 'string', 'Failed result must have reason string');
    assert.ok(result.category.length > 0, 'Category must not be empty');
    assert.ok(result.reason.length > 0, 'Reason must not be empty');
  }

  console.log('  ✓ testSelfCheckReturnsResultShape');
}

async function run() {
  testBuildSshArgsStructure();
  testBuildSshArgsWithKeyFile();
  testBuildSshArgsWithoutKeyFile();
  testSshSettingsStructure();
  await testSelfCheckReturnsResultShape();

  console.log('ssh-self-check.test: PASS');
}

run().catch((err) => {
  console.error('ssh-self-check.test: FAIL');
  console.error(err);
  process.exit(1);
});
