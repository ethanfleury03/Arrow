const assert = require('node:assert/strict');
const { runSshSelfCheck, buildSshArgs, buildSshSettings, isSshConfigured } = require('../bridge/real-client-factory.local');
const { loadBridgeConfig } = require('../bridge/config');

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

function testBridgeCheckReusesStartupConfig() {
  // Verify that self-check uses the same config loading path as bridge:start
  // by checking that loadBridgeConfig is importable and returns expected structure
  const config = loadBridgeConfig(process.env);

  // Config must have memjet section with host/ports
  assert.ok(typeof config === 'object', 'loadBridgeConfig must return an object');
  assert.ok(typeof config.memjet === 'object', 'config.memjet must be an object');
  assert.ok(typeof config.memjet.host === 'string', 'config.memjet.host must be a string');
  assert.ok(typeof config.memjet.commandPort === 'number', 'config.memjet.commandPort must be a number');
  assert.ok(typeof config.memjet.eventPort === 'number', 'config.memjet.eventPort must be a number');
  assert.ok(typeof config.memjet.dataPort === 'number', 'config.memjet.dataPort must be a number');

  // buildSshSettings should use config.memjet values
  const settings = buildSshSettings({
    host: config.memjet.host,
    commandPort: config.memjet.commandPort,
    eventPort: config.memjet.eventPort,
    dataPort: config.memjet.dataPort
  });

  // Settings should inherit defaults from config
  assert.ok(typeof settings === 'object', 'buildSshSettings must return an object');
  assert.ok(typeof settings.sshHost === 'string', 'settings.sshHost must be a string');
  assert.ok(typeof settings.cmdTemplate === 'string', 'settings.cmdTemplate must have default value');

  console.log('  ✓ testBridgeCheckReusesStartupConfig');
}

function testNoSkipWithConfiguredDefaults() {
  // Test that SSH check does NOT skip when using default cmdTemplate
  // (only host and user are required, cmdTemplate has a default)

  // Save original env
  const originalHost = process.env.MEMJET_SSH_HOST;
  const originalUser = process.env.MEMJET_SSH_USER;
  const originalCmdTemplate = process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE;
  const originalBackend = process.env.MEMJET_REAL_BACKEND;

  try {
    // Set only host and user, leave cmdTemplate to default
    process.env.MEMJET_SSH_HOST = '192.168.111.1';
    process.env.MEMJET_SSH_USER = 'arrow';
    delete process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE;
    process.env.MEMJET_REAL_BACKEND = 'ssh';

    // Reload config with new env
    const config = loadBridgeConfig(process.env);
    const settings = buildSshSettings({
      host: config.memjet.host,
      commandPort: config.memjet.commandPort,
      eventPort: config.memjet.eventPort,
      dataPort: config.memjet.dataPort
    });

    // Verify settings are complete (no missing required fields for host/user)
    assert.ok(settings.sshHost === '192.168.111.1', 'sshHost should be set from env');
    assert.ok(settings.sshUser === 'arrow', 'sshUser should be set from env');

    // cmdTemplate should have default value, not be empty - this is the key fix!
    assert.ok(settings.cmdTemplate.length > 0, 'cmdTemplate should have default value when not explicitly set');
    assert.ok(settings.cmdTemplate.includes('pesctl'), 'default cmdTemplate should reference pesctl');

    // The key assertion: settings.missing should NOT include cmdTemplate since it has a default
    // Only host and user should be considered "missing" if not provided
    assert.ok(!settings.missing.includes('MEMJET_SSH_REMOTE_CMD_TEMPLATE'),
      'MEMJET_SSH_REMOTE_CMD_TEMPLATE should not be in missing when using default');

  } finally {
    // Restore original env
    if (originalHost !== undefined) process.env.MEMJET_SSH_HOST = originalHost;
    else delete process.env.MEMJET_SSH_HOST;
    if (originalUser !== undefined) process.env.MEMJET_SSH_USER = originalUser;
    else delete process.env.MEMJET_SSH_USER;
    if (originalCmdTemplate !== undefined) process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE = originalCmdTemplate;
    else delete process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE;
    if (originalBackend !== undefined) process.env.MEMJET_REAL_BACKEND = originalBackend;
    else delete process.env.MEMJET_REAL_BACKEND;
  }

  console.log('  ✓ testNoSkipWithConfiguredDefaults');
}

function testCmdTemplateDefaultValue() {
  // Test that buildSshSettings provides a sensible default for cmdTemplate
  const settings = buildSshSettings({
    host: '192.168.111.1',
    commandPort: 13001,
    eventPort: 9231,
    dataPort: 13001
  });

  // Default cmdTemplate should exist and contain expected placeholders
  assert.ok(typeof settings.cmdTemplate === 'string', 'cmdTemplate must be a string');
  assert.ok(settings.cmdTemplate.length > 0, 'cmdTemplate must not be empty');
  assert.ok(settings.cmdTemplate.includes('{operation}'), 'cmdTemplate should include {operation} placeholder');
  assert.ok(settings.cmdTemplate.includes('{args_json_b64}'), 'cmdTemplate should include {args_json_b64} placeholder');
  assert.ok(settings.cmdTemplate.includes('{host}'), 'cmdTemplate should include {host} placeholder');

  console.log('  ✓ testCmdTemplateDefaultValue');
}

async function run() {
  testBuildSshArgsStructure();
  testBuildSshArgsWithKeyFile();
  testBuildSshArgsWithoutKeyFile();
  testSshSettingsStructure();
  await testSelfCheckReturnsResultShape();
  testBridgeCheckReusesStartupConfig();
  testNoSkipWithConfiguredDefaults();
  testCmdTemplateDefaultValue();

  console.log('ssh-self-check.test: PASS');
}

run().catch((err) => {
  console.error('ssh-self-check.test: FAIL');
  console.error(err);
  process.exit(1);
});
