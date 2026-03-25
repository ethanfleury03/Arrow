const assert = require('node:assert/strict');
const { selectBackendCandidates } = require('../bridge/real-client-factory.local');

function run() {
  const autoNoSsh = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'auto' });
  assert.equal(autoNoSsh.requestedBackend, 'auto');
  assert.deepEqual(autoNoSsh.candidates, ['local']);

  const autoWithSsh = selectBackendCandidates({
    MEMJET_REAL_BACKEND: 'auto',
    MEMJET_SSH_HOST: '10.0.0.2',
    MEMJET_SSH_USER: 'arrow',
    MEMJET_SSH_KEY_PATH: '/tmp/key.pem',
    MEMJET_SSH_REMOTE_CMD_TEMPLATE: '/opt/arrow/bin/memjet-bridge-op --op {operation}'
  });
  assert.equal(autoWithSsh.requestedBackend, 'auto');
  assert.deepEqual(autoWithSsh.candidates, ['local', 'ssh']);

  const explicitLocal = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'local' });
  assert.equal(explicitLocal.requestedBackend, 'local');
  assert.deepEqual(explicitLocal.candidates, ['local']);

  const explicitSsh = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'ssh' });
  assert.equal(explicitSsh.requestedBackend, 'ssh');
  assert.deepEqual(explicitSsh.candidates, ['ssh']);

  console.log('real-client-selection.test: PASS');
}

run();
