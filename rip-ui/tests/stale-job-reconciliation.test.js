const assert = require('node:assert/strict');

/**
 * Test stale job reconciliation logic
 * These tests verify that jobs in active statuses are properly detected and marked
 * as failed when they are stale (missing file reference or >24h old)
 */

// Constants matching app.js
const JOB_STATUS = Object.freeze({
  DRAFT: 'draft',
  VALIDATED: 'validated',
  QUEUED: 'queued',
  SENDING: 'sending',
  PREPARING: 'preparing',
  PRINTING: 'printing',
  SENT: 'sent',
  COMPLETED: 'completed',
  DONE: 'done',
  FAILED: 'failed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
});

// Replicate the reconcileStaleJobs logic for testing
const ACTIVE_STATUSES_FOR_RECONCILIATION = new Set([
  JOB_STATUS.QUEUED,
  JOB_STATUS.SENDING,
  JOB_STATUS.PREPARING,
  JOB_STATUS.PRINTING,
  JOB_STATUS.SENT
]);

const STALE_AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

function reconcileStaleJobs(jobs, now = Date.now()) {
  let staleCount = 0;

  const reconciled = jobs.map(job => {
    const status = job.status || job.state || '';

    // Only check jobs in active statuses
    if (!ACTIVE_STATUSES_FOR_RECONCILIATION.has(status)) {
      return job;
    }

    // Check if job has usable file reference
    const hasFileReference = Boolean(
      job.inputPath ||
      job.artifactPath ||
      job.fileName ||
      job.name
    );

    // Check job age
    const updatedAtMs = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
    const createdAtMs = job.createdAt ? new Date(job.createdAt).getTime() : 0;
    const jobTimeMs = updatedAtMs || createdAtMs || now;
    const ageMs = now - jobTimeMs;
    const isOld = ageMs > STALE_AGE_THRESHOLD_MS;

    // Determine if job is stale
    const isStale = !hasFileReference || isOld;

    if (isStale) {
      staleCount++;
      const reason = !hasFileReference
        ? 'stale_on_restart: missing file reference'
        : 'stale_on_restart: job older than 24h';

      return {
        ...job,
        status: JOB_STATUS.FAILED,
        state: JOB_STATUS.FAILED,
        failReason: reason,
        error: reason,
        failedAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        history: [
          ...(job.history || []),
          {
            at: new Date(now).toISOString(),
            state: JOB_STATUS.FAILED,
            from: status,
            reason
          }
        ]
      };
    }

    return job;
  });

  return { jobs: reconciled, staleCount };
}

// Test 1: Jobs with missing file references should be marked as stale
function testMissingFileReference() {
  console.log('\n  Testing stale detection for missing file references...');

  const now = Date.now();
  const recentTime = new Date(now - 1000 * 60 * 60).toISOString(); // 1 hour ago

  const jobs = [
    {
      id: 'JOB-001',
      status: JOB_STATUS.QUEUED,
      createdAt: recentTime,
      updatedAt: recentTime,
      // Missing: inputPath, artifactPath, fileName, name
    },
    {
      id: 'JOB-002',
      status: JOB_STATUS.PREPARING,
      createdAt: recentTime,
      updatedAt: recentTime,
      // Has file reference via name
      name: 'document.pdf'
    },
    {
      id: 'JOB-003',
      status: JOB_STATUS.PRINTING,
      createdAt: recentTime,
      updatedAt: recentTime,
      // Has file reference via inputPath
      inputPath: '/path/to/file.pdf'
    },
    {
      id: 'JOB-004',
      status: JOB_STATUS.SENDING,
      createdAt: recentTime,
      updatedAt: recentTime,
      // Has file reference via artifactPath
      artifactPath: '/artifacts/job.pdf'
    },
    {
      id: 'JOB-005',
      status: JOB_STATUS.SENT,
      createdAt: recentTime,
      updatedAt: recentTime,
      // Has file reference via fileName
      fileName: 'printjob.pdf'
    }
  ];

  const result = reconcileStaleJobs(jobs, now);

  // JOB-001 should be marked as stale (no file reference)
  assert.strictEqual(result.jobs[0].status, JOB_STATUS.FAILED, 'JOB-001 should be FAILED');
  assert.strictEqual(result.jobs[0].failReason, 'stale_on_restart: missing file reference');
  assert.ok(result.jobs[0].error.includes('missing file reference'));
  assert.ok(result.jobs[0].failedAt);
  assert.ok(result.jobs[0].history.some(h => h.reason.includes('missing file reference')));

  // JOB-002 through JOB-005 should remain unchanged
  assert.strictEqual(result.jobs[1].status, JOB_STATUS.PREPARING, 'JOB-002 should remain PREPARING');
  assert.strictEqual(result.jobs[2].status, JOB_STATUS.PRINTING, 'JOB-003 should remain PRINTING');
  assert.strictEqual(result.jobs[3].status, JOB_STATUS.SENDING, 'JOB-004 should remain SENDING');
  assert.strictEqual(result.jobs[4].status, JOB_STATUS.SENT, 'JOB-005 should remain SENT');

  // Should have 1 stale job
  assert.strictEqual(result.staleCount, 1, 'Should detect 1 stale job');

  console.log('  ✓ Missing file reference detection works correctly');
}

// Test 2: Old jobs (>24h) should be marked as stale
function testOldJobDetection() {
  console.log('\n  Testing stale detection for old jobs (>24h)...');

  const now = Date.now();
  const recentTime = new Date(now - 1000 * 60 * 60).toISOString(); // 1 hour ago
  const oldTime = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

  const jobs = [
    {
      id: 'JOB-001',
      status: JOB_STATUS.QUEUED,
      name: 'recent.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    },
    {
      id: 'JOB-002',
      status: JOB_STATUS.PREPARING,
      name: 'old.pdf',
      createdAt: oldTime,
      updatedAt: oldTime
    },
    {
      id: 'JOB-003',
      status: JOB_STATUS.PRINTING,
      name: 'updated_recently.pdf',
      createdAt: oldTime,
      updatedAt: recentTime // Updated recently, should not be stale
    }
  ];

  const result = reconcileStaleJobs(jobs, now);

  // JOB-001 should remain unchanged (recent)
  assert.strictEqual(result.jobs[0].status, JOB_STATUS.QUEUED, 'Recent job should remain QUEUED');

  // JOB-002 should be marked as stale (old)
  assert.strictEqual(result.jobs[1].status, JOB_STATUS.FAILED, 'Old job should be FAILED');
  assert.ok(result.jobs[1].failReason.includes('older than 24h'));

  // JOB-003 should remain unchanged (updated recently)
  assert.strictEqual(result.jobs[2].status, JOB_STATUS.PRINTING, 'Recently updated job should remain PRINTING');

  assert.strictEqual(result.staleCount, 1, 'Should detect 1 stale job');

  console.log('  ✓ Old job detection works correctly');
}

// Test 3: Terminal status jobs should not be reconciled
function testTerminalJobsPreserved() {
  console.log('\n  Testing that terminal jobs are not modified...');

  const now = Date.now();
  const oldTime = new Date(now - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

  const jobs = [
    {
      id: 'JOB-001',
      status: JOB_STATUS.DONE,
      // Missing file reference but terminal - should not be touched
      createdAt: oldTime,
      updatedAt: oldTime
    },
    {
      id: 'JOB-002',
      status: JOB_STATUS.COMPLETED,
      // Missing file reference but terminal - should not be touched
      createdAt: oldTime,
      updatedAt: oldTime
    },
    {
      id: 'JOB-003',
      status: JOB_STATUS.FAILED,
      // Missing file reference but terminal - should not be touched
      createdAt: oldTime,
      updatedAt: oldTime
    },
    {
      id: 'JOB-004',
      status: JOB_STATUS.ERROR,
      // Missing file reference but terminal - should not be touched
      createdAt: oldTime,
      updatedAt: oldTime
    },
    {
      id: 'JOB-005',
      status: JOB_STATUS.CANCELLED,
      // Missing file reference but terminal - should not be touched
      createdAt: oldTime,
      updatedAt: oldTime
    }
  ];

  const result = reconcileStaleJobs(jobs, now);

  // All terminal jobs should remain unchanged
  assert.strictEqual(result.jobs[0].status, JOB_STATUS.DONE);
  assert.strictEqual(result.jobs[1].status, JOB_STATUS.COMPLETED);
  assert.strictEqual(result.jobs[2].status, JOB_STATUS.FAILED);
  assert.strictEqual(result.jobs[3].status, JOB_STATUS.ERROR);
  assert.strictEqual(result.jobs[4].status, JOB_STATUS.CANCELLED);

  assert.strictEqual(result.staleCount, 0, 'Should not mark any terminal jobs as stale');

  console.log('  ✓ Terminal jobs are preserved correctly');
}

// Test 4: Non-stale active jobs should be preserved
function testNonStaleActiveJobsPreserved() {
  console.log('\n  Testing that non-stale active jobs are preserved...');

  const now = Date.now();
  const recentTime = new Date(now - 1000 * 60 * 60).toISOString(); // 1 hour ago

  const jobs = [
    {
      id: 'JOB-001',
      status: JOB_STATUS.QUEUED,
      name: 'queued.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    },
    {
      id: 'JOB-002',
      status: JOB_STATUS.SENDING,
      name: 'sending.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    },
    {
      id: 'JOB-003',
      status: JOB_STATUS.PREPARING,
      name: 'preparing.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    },
    {
      id: 'JOB-004',
      status: JOB_STATUS.PRINTING,
      name: 'printing.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    },
    {
      id: 'JOB-005',
      status: JOB_STATUS.SENT,
      name: 'sent.pdf',
      createdAt: recentTime,
      updatedAt: recentTime
    }
  ];

  const result = reconcileStaleJobs(jobs, now);

  // All active jobs with file references should remain unchanged
  assert.strictEqual(result.jobs[0].status, JOB_STATUS.QUEUED);
  assert.strictEqual(result.jobs[1].status, JOB_STATUS.SENDING);
  assert.strictEqual(result.jobs[2].status, JOB_STATUS.PREPARING);
  assert.strictEqual(result.jobs[3].status, JOB_STATUS.PRINTING);
  assert.strictEqual(result.jobs[4].status, JOB_STATUS.SENT);

  assert.strictEqual(result.staleCount, 0, 'Should not mark any non-stale jobs');

  console.log('  ✓ Non-stale active jobs are preserved correctly');
}

// Test 5: History is preserved when marking stale
function testHistoryPreservation() {
  console.log('\n  Testing history preservation during stale reconciliation...');

  const now = Date.now();
  const oldTime = new Date(now - 25 * 60 * 60 * 1000).toISOString();

  const jobs = [
    {
      id: 'JOB-001',
      status: JOB_STATUS.QUEUED,
      createdAt: oldTime,
      updatedAt: oldTime,
      history: [
        { at: oldTime, state: JOB_STATUS.DRAFT, reason: 'created' },
        { at: oldTime, state: JOB_STATUS.QUEUED, reason: 'validated' }
      ]
    }
  ];

  const result = reconcileStaleJobs(jobs, now);

  // History should be preserved and new entry added
  assert.strictEqual(result.jobs[0].history.length, 3, 'History should have 3 entries');
  assert.strictEqual(result.jobs[0].history[0].state, JOB_STATUS.DRAFT);
  assert.strictEqual(result.jobs[0].history[1].state, JOB_STATUS.QUEUED);
  assert.strictEqual(result.jobs[0].history[2].state, JOB_STATUS.FAILED);
  assert.strictEqual(result.jobs[0].history[2].from, JOB_STATUS.QUEUED);
  assert.ok(result.jobs[0].history[2].reason.includes('stale_on_restart'));

  console.log('  ✓ History is preserved correctly');
}

// Test 6: Edge cases
function testEdgeCases() {
  console.log('\n  Testing edge cases...');

  const now = Date.now();

  // Empty jobs array
  const emptyResult = reconcileStaleJobs([], now);
  assert.deepStrictEqual(emptyResult.jobs, []);
  assert.strictEqual(emptyResult.staleCount, 0);

  // Job with null/undefined status
  const nullStatusJob = [
    {
      id: 'JOB-NULL',
      status: null,
      name: 'test.pdf',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    }
  ];
  const nullResult = reconcileStaleJobs(nullStatusJob, now);
  assert.strictEqual(nullResult.jobs[0].status, null);

  // Job with exactly 24h old (boundary case - should NOT be stale with > threshold)
  const exactly24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const boundaryJob = [
    {
      id: 'JOB-BOUNDARY',
      status: JOB_STATUS.QUEUED,
      name: 'boundary.pdf',
      createdAt: exactly24h,
      updatedAt: exactly24h
    }
  ];
  const boundaryResult = reconcileStaleJobs(boundaryJob, now);
  // Should NOT be stale since threshold is > 24h, not >= 24h
  assert.strictEqual(boundaryResult.jobs[0].status, JOB_STATUS.QUEUED);

  // Job just under 24h (should not be stale)
  const justUnder24h = new Date(now - 23 * 60 * 60 * 1000 - 59 * 60 * 1000).toISOString();
  const freshJob = [
    {
      id: 'JOB-FRESH',
      status: JOB_STATUS.QUEUED,
      name: 'fresh.pdf',
      createdAt: justUnder24h,
      updatedAt: justUnder24h
    }
  ];
  const freshResult = reconcileStaleJobs(freshJob, now);
  assert.strictEqual(freshResult.jobs[0].status, JOB_STATUS.QUEUED);

  console.log('  ✓ Edge cases handled correctly');
}

// Run all tests
function runAllTests() {
  console.log('\nStale Job Reconciliation Tests\n');

  try {
    testMissingFileReference();
    testOldJobDetection();
    testTerminalJobsPreserved();
    testNonStaleActiveJobsPreserved();
    testHistoryPreservation();
    testEdgeCases();

    console.log('\n✓ All stale job reconciliation tests passed\n');
    return true;
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runAllTests();