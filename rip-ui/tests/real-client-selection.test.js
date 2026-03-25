const assert = require('node:assert/strict');
const { selectBackendCandidates } = require('../bridge/real-client-factory.local');

function run() {
  const defaultSelection = selectBackendCandidates({});
  assert.equal(defaultSelection.requestedBackend, 'local');
  assert.deepEqual(defaultSelection.candidates, ['local']);

  const explicitLocal = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'local' });
  assert.equal(explicitLocal.requestedBackend, 'local');
  assert.deepEqual(explicitLocal.candidates, ['local']);

  const explicitAuto = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'auto' });
  assert.equal(explicitAuto.requestedBackend, 'auto');
  assert.deepEqual(explicitAuto.candidates, ['local']);

  const explicitSsh = selectBackendCandidates({ MEMJET_REAL_BACKEND: 'ssh' });
  assert.equal(explicitSsh.requestedBackend, 'ssh');
  assert.deepEqual(explicitSsh.candidates, ['local']);

  console.log('real-client-selection.test: PASS');
}

run();
