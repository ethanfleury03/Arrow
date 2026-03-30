const assert = require('node:assert/strict');
const { createBridgeServer } = require('../bridge/server');

async function run() {
  const bridge = createBridgeServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'error',
      memjet: { mode: 'stub', protocol: 'thrift-compact' },
      dataDir: '/tmp/rip-bridge-v1-test'
    }
  });

  await bridge.start();
  const { port } = bridge.server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.ok, true);

  const created = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'JOB_TEST_V1', copies: 2, fileName: 'a.pdf' })
  }).then(r => r.json());
  assert.equal(created.state, 'validated');

  const sent = await fetch(`${base}/api/jobs/JOB_TEST_V1/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ copies: 2 })
  }).then(r => r.json());
  assert.equal(sent.state, 'completed');

  const queue = await fetch(`${base}/api/queue`).then(r => r.json());
  assert.equal(Array.isArray(queue.queue), true);
  assert.equal(queue.queue.length, 0);

  const cancelledCreate = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'JOB_CANCEL_TEST', copies: 1, fileName: 'b.pdf' })
  }).then(r => r.json());
  assert.equal(cancelledCreate.state, 'validated');

  const cancelled = await fetch(`${base}/api/jobs/JOB_CANCEL_TEST/cancel`, { method: 'POST' }).then(r => r.json());
  assert.equal(cancelled.state, 'cancelled');

  // Path traversal: ingest with malicious fileName must sanitize
  const traversalRes = await fetch(`${base}/api/jobs/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: '../../etc/passwd',
      contentBase64: Buffer.from('test').toString('base64')
    })
  });
  const traversalJob = await traversalRes.json();
  if (traversalRes.status === 201) {
    const fs = require('node:fs');
    const path = require('node:path');
    assert.ok(
      traversalJob.artifactPath == null || !traversalJob.artifactPath.includes('etc/passwd'),
      'Traversal fileName must be sanitized out of artifact path'
    );
    assert.ok(
      traversalJob.fileName !== '../../etc/passwd',
      'Stored fileName must not contain path separators'
    );
  }
  console.log('  ✓ path-traversal-ingest');

  // Sanitization: special characters in fileName
  const specialRes = await fetch(`${base}/api/jobs/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: 'my file (1)  <test>.pdf',
      contentBase64: Buffer.from('test').toString('base64')
    })
  });
  assert.equal(specialRes.status, 201);
  const specialJob = await specialRes.json();
  assert.ok(!/[<>() ]/.test(specialJob.fileName), 'Special chars must be sanitized from fileName');
  console.log('  ✓ filename-sanitization');

  await bridge.stop();
  console.log('bridge-v1.test: PASS');
}

run().catch(async error => {
  console.error('bridge-v1.test: FAIL');
  console.error(error);
  process.exit(1);
});
