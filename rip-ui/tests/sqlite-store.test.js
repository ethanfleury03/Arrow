const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { SqliteStore } = require('../bridge/storage');

const TEST_DB_DIR = '/tmp/rip-bridge-sqlite-test';

function setup() {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  const dbPath = path.join(TEST_DB_DIR, `test-${Date.now()}.db`);
  return new SqliteStore({ dbPath, logger: { info: () => {}, error: () => {}, debug: () => {} } });
}

function cleanup(store) {
  store.close();
}

function testMigrations() {
  const store = setup();
  const version = store.migrate();
  assert.equal(version, 1, 'Should migrate to version 1');
  cleanup(store);
}

function testCreateAndGetJob() {
  const store = setup();
  store.migrate();

  const job = {
    jobId: 'test-job-1',
    runId: null,
    state: 'draft',
    copies: 1,
    fileName: 'test.pdf',
    artifactPath: '/tmp/test.pdf',
    source: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [{ at: new Date().toISOString(), state: 'draft' }]
  };

  store.createJob(job);
  const retrieved = store.getJob('test-job-1');

  assert.equal(retrieved.jobId, 'test-job-1');
  assert.equal(retrieved.state, 'draft');
  assert.equal(retrieved.copies, 1);
  assert.equal(retrieved.fileName, 'test.pdf');
  assert.equal(retrieved.history.length, 1);

  cleanup(store);
}

function testUpdateJob() {
  const store = setup();
  store.migrate();

  const job = {
    jobId: 'test-job-2',
    runId: null,
    state: 'draft',
    copies: 1,
    fileName: 'test.pdf',
    artifactPath: '/tmp/test.pdf',
    source: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  };

  store.createJob(job);

  job.state = 'validated';
  job.updatedAt = new Date().toISOString();
  job.history.push({ at: job.updatedAt, state: 'validated' });

  store.updateJob(job);
  const retrieved = store.getJob('test-job-2');

  assert.equal(retrieved.state, 'validated');
  assert.equal(retrieved.history.length, 1);

  cleanup(store);
}

function testJobEvents() {
  const store = setup();
  store.migrate();

  const job = {
    jobId: 'test-job-3',
    runId: null,
    state: 'draft',
    copies: 1,
    fileName: 'test.pdf',
    artifactPath: '/tmp/test.pdf',
    source: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  };

  store.createJob(job);
  store.recordJobEvent('test-job-3', 'run-1', 'queued', { reason: 'send' });
  store.recordJobEvent('test-job-3', 'run-1', 'printing', { progress: 50 });

  const events = store.getJobEvents('test-job-3');
  assert.equal(events.length, 2);
  assert.equal(events[0].state, 'queued');
  assert.equal(events[1].state, 'printing');
  assert.equal(events[1].extra.progress, 50);

  cleanup(store);
}

function testCommands() {
  const store = setup();
  store.migrate();

  const id = store.recordCommand({
    command: 'engine_initialise',
    jobId: 'job-1',
    accepted: true,
    result: { ok: true },
    error: null,
    durationMs: 150
  });

  assert.ok(id > 0, 'Should return command ID');

  const commands = store.getCommands({ limit: 10 });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, 'engine_initialise');
  assert.equal(commands[0].accepted, true);
  assert.equal(commands[0].durationMs, 150);

  cleanup(store);
}

function testDeviceStatusSnapshots() {
  const store = setup();
  store.migrate();

  const id1 = store.recordDeviceStatus({
    engineState: 'READY',
    engineStateRawNumeric: 6,
    engineStateRawLabel: 'PRIMED_IDLE',
    queueLength: 0,
    connected: true,
    degraded: false,
    inkLevels: { C: 100, M: 90, Y: 80, K: 70 },
    details: { diagnostics: {} }
  });

  const id2 = store.recordDeviceStatus({
    engineState: 'PRINTING',
    engineStateRawNumeric: 10,
    engineStateRawLabel: 'PRINTING',
    queueLength: 1,
    connected: true,
    degraded: false,
    inkLevels: { C: 95, M: 85, Y: 75, K: 65 }
  });

  assert.ok(id1 > 0);
  assert.ok(id2 > 0);

  const latest = store.getLatestDeviceStatus();
  assert.equal(latest.engineState, 'PRINTING');
  assert.equal(latest.queueLength, 1);

  const history = store.getDeviceStatusHistory({ limit: 2 });
  assert.equal(history.length, 2);

  cleanup(store);
}

function testAuditLog() {
  const store = setup();
  store.migrate();

  store.appendAudit('info', 'test.message', { foo: 'bar' });
  store.appendAudit('error', 'test.error', { code: 500 });
  store.appendAudit('warn', 'test.warning', { detail: 'something' });

  const allLogs = store.getAuditLog({ limit: 10 });
  assert.equal(allLogs.length, 3);

  const errorLogs = store.getAuditLog({ level: 'error', limit: 10 });
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0].msg, 'test.error');

  cleanup(store);
}

function testGetAllJobs() {
  const store = setup();
  store.migrate();

  store.createJob({
    jobId: 'job-1',
    runId: null,
    state: 'completed',
    copies: 1,
    fileName: 'a.pdf',
    artifactPath: '/tmp/a.pdf',
    source: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  });

  store.createJob({
    jobId: 'job-2',
    runId: null,
    state: 'queued',
    copies: 2,
    fileName: 'b.pdf',
    artifactPath: '/tmp/b.pdf',
    source: 'api',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  });

  const allJobs = store.getAllJobs();
  assert.equal(allJobs.length, 2);

  const queuedJobs = store.getJobsByState('queued');
  assert.equal(queuedJobs.length, 1);
  assert.equal(queuedJobs[0].jobId, 'job-2');

  cleanup(store);
}

function testDeleteOldRecordsWhitelist() {
  const store = setup();
  store.migrate();

  store.appendAudit('info', 'old.msg', {});

  const deleted = store.deleteOldRecords('audit_log', -1);
  assert.equal(typeof deleted, 'number');

  let threw = false;
  try {
    store.deleteOldRecords('jobs; DROP TABLE jobs; --', 1);
  } catch (error) {
    threw = true;
    assert.ok(error.message.includes('not in the allowed purgeable list'));
  }
  assert.ok(threw, 'deleteOldRecords must reject disallowed table names');

  let threwJobs = false;
  try {
    store.deleteOldRecords('jobs', 1);
  } catch {
    threwJobs = true;
  }
  assert.ok(threwJobs, 'deleteOldRecords must reject the jobs table');

  cleanup(store);
}

async function run() {
  testMigrations();
  console.log('✓ testMigrations');

  testCreateAndGetJob();
  console.log('✓ testCreateAndGetJob');

  testUpdateJob();
  console.log('✓ testUpdateJob');

  testJobEvents();
  console.log('✓ testJobEvents');

  testCommands();
  console.log('✓ testCommands');

  testDeviceStatusSnapshots();
  console.log('✓ testDeviceStatusSnapshots');

  testAuditLog();
  console.log('✓ testAuditLog');

  testGetAllJobs();
  console.log('✓ testGetAllJobs');

  testDeleteOldRecordsWhitelist();
  console.log('✓ testDeleteOldRecordsWhitelist');

  console.log('sqlite-store.test: PASS');
}

run().catch(error => {
  console.error('sqlite-store.test: FAIL');
  console.error(error);
  process.exit(1);
});
