const assert = require('node:assert/strict');
const { createBridgeServer } = require('../bridge/server');
const fs = require('node:fs');
const path = require('node:path');

async function run() {
  // Use unique data directory for this test
  const dataDir = `/tmp/rip-bridge-jobs-hydration-test-${Date.now()}`;
  
  // Clean up any existing data
  try { fs.rmSync(dataDir, { recursive: true }); } catch {}
  
  const bridge = createBridgeServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'error',
      memjet: { mode: 'stub', protocol: 'thrift-compact' },
      dataDir
    }
  });

  await bridge.start();
  const { port } = bridge.server.address();
  const base = `http://127.0.0.1:${port}`;

  // Test 1: GET /api/jobs returns empty array initially
  const emptyList = await fetch(`${base}/api/jobs`).then(r => r.json());
  assert.equal(Array.isArray(emptyList.jobs), true);
  assert.equal(emptyList.jobs.length, 0);
  assert.equal(emptyList.source, 'bridge-http');
  assert.equal(typeof emptyList.timestamp, 'string');
  assert.equal(emptyList.count, 0);
  console.log('  ✓ get-jobs-empty');

  // Test 2: Create some jobs
  const job1 = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'JOB_HYDRATE_001', copies: 1, fileName: 'test1.pdf' })
  }).then(r => r.json());
  assert.equal(job1.jobId, 'JOB_HYDRATE_001');

  const job2 = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'JOB_HYDRATE_002', copies: 2, fileName: 'test2.pdf' })
  }).then(r => r.json());
  assert.equal(job2.jobId, 'JOB_HYDRATE_002');

  // Test 3: GET /api/jobs returns created jobs
  const listWithJobs = await fetch(`${base}/api/jobs`).then(r => r.json());
  assert.equal(listWithJobs.jobs.length, 2);
  assert.equal(listWithJobs.count, 2);
  
  const jobIds = listWithJobs.jobs.map(j => j.jobId);
  assert.ok(jobIds.includes('JOB_HYDRATE_001'));
  assert.ok(jobIds.includes('JOB_HYDRATE_002'));
  console.log('  ✓ get-jobs-with-data');

  // Test 4: Jobs are ordered by created_at DESC (newest first)
  const createdAts = listWithJobs.jobs.map(j => j.createdAt);
  assert.ok(createdAts[0] >= createdAts[1], 'Jobs should be ordered by created_at DESC');
  console.log('  ✓ get-jobs-ordering');

  // Test 5: Jobs have expected structure
  const firstJob = listWithJobs.jobs[0];
  assert.ok(firstJob.jobId, 'Job should have jobId');
  assert.ok(firstJob.state, 'Job should have state');
  assert.ok(firstJob.createdAt, 'Job should have createdAt');
  assert.ok(firstJob.updatedAt, 'Job should have updatedAt');
  assert.ok(Array.isArray(firstJob.history), 'Job should have history array');
  console.log('  ✓ get-jobs-structure');

  // Test 6: GET /api/jobs/:id still works
  const singleJob = await fetch(`${base}/api/jobs/JOB_HYDRATE_001`).then(r => r.json());
  assert.equal(singleJob.jobId, 'JOB_HYDRATE_001');
  assert.equal(singleJob.fileName, 'test1.pdf');
  console.log('  ✓ get-single-job');

  // Test 7: GET /api/jobs/:id returns 404 for non-existent job
  const notFound = await fetch(`${base}/api/jobs/NONEXISTENT`);
  assert.equal(notFound.status, 404);
  const notFoundBody = await notFound.json();
  assert.equal(notFoundBody.error, 'job_not_found');
  console.log('  ✓ get-job-not-found');

  await bridge.stop();
  
  // Clean up test data
  try { fs.rmSync(dataDir, { recursive: true }); } catch {}
  
  console.log('bridge-jobs-hydration.test: PASS');
}

run().catch(async error => {
  console.error('bridge-jobs-hydration.test: FAIL');
  console.error(error);
  process.exit(1);
});
