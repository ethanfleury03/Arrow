const assert = require('node:assert/strict');

/**
 * Test the determineJobStatusFromResult logic by extracting and testing it directly
 */

// Replicate the determineJobStatusFromResult logic for testing
const JOB_STATUS = {
  DONE: 'done',
  FAILED: 'failed',
  PRINTING: 'printing',
  SENDING: 'sending',
  QUEUED: 'queued',
  PREPARING: 'preparing',
  SENT: 'sent',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

const TERMINAL_JOB_STATUSES = new Set([
  JOB_STATUS.DONE, JOB_STATUS.COMPLETED, JOB_STATUS.FAILED, 
  JOB_STATUS.ERROR, JOB_STATUS.CANCELLED
]);

const ACTIVE_JOB_STATUSES = new Set([
  JOB_STATUS.SENDING, JOB_STATUS.PREPARING, JOB_STATUS.PRINTING, JOB_STATUS.SENT
]);

function determineJobStatusFromResult(result) {
  const TERMINAL_SUCCESS_STATUSES = ['completed', 'done', 'finished', 'success'];
  const NON_TERMINAL_STATUSES = ['accepted', 'sent', 'printing', 'preparing', 'queued', 'submitted'];
  const FAILURE_STATUSES = ['failed', 'error', 'rejected', 'cancelled', 'timeout'];

  const resultStatus = String(result?.status || '').toLowerCase().trim();
  const resultAccepted = result?.accepted === true;
  const resultError = result?.error || result?.message;

  // Case 1: Explicit error in result -> FAILED
  if (resultError && !resultAccepted) {
    const errorStr = String(resultError).toLowerCase();
    const isTerminalError = FAILURE_STATUSES.some(token => errorStr.includes(token));
    if (isTerminalError) {
      return { 
        status: JOB_STATUS.FAILED, 
        reason: `bridge-error: ${resultError}`,
        isTerminal: true 
      };
    }
  }

  // Case 2: Check for explicit terminal success
  if (TERMINAL_SUCCESS_STATUSES.some(token => resultStatus.includes(token))) {
    return { 
      status: JOB_STATUS.DONE, 
      reason: 'bridge-confirmed-completion',
      isTerminal: true 
    };
  }

  // Case 3: Check for explicit failure status
  if (FAILURE_STATUSES.some(token => resultStatus.includes(token))) {
    return { 
      status: JOB_STATUS.FAILED, 
      reason: `bridge-status: ${resultStatus}`,
      isTerminal: true 
    };
  }

  // Case 4: Accepted or non-terminal status -> PRINTING (await completion)
  if (resultAccepted || NON_TERMINAL_STATUSES.some(token => resultStatus.includes(token))) {
    return { 
      status: JOB_STATUS.PRINTING, 
      reason: resultAccepted ? 'bridge-accepted' : 'bridge-status-incomplete',
      isTerminal: false 
    };
  }

  // Case 5: No explicit status but result exists -> assume printing (non-terminal)
  if (result && typeof result === 'object') {
    return { 
      status: JOB_STATUS.PRINTING, 
      reason: 'bridge-response-without-status',
      isTerminal: false 
    };
  }

  // Case 6: Unknown/empty result -> FAILED (explicit failure condition)
  return { 
    status: JOB_STATUS.FAILED, 
    reason: 'empty-or-invalid-bridge-response',
    isTerminal: true 
  };
}

function normalizeJobStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isTerminalJobStatus(status) {
  const normalized = normalizeJobStatus(status);
  return TERMINAL_JOB_STATUSES.has(normalized);
}

function isActiveJobStatus(status) {
  const normalized = normalizeJobStatus(status);
  return ACTIVE_JOB_STATUSES.has(normalized);
}

function testStatusClassification() {
  console.log('\n  Testing status classification logic...');
  
  const testCases = [
    // [result, expectedStatus, expectedTerminal, description]
    [{ status: 'completed' }, JOB_STATUS.DONE, true, 'completed status'],
    [{ status: 'done' }, JOB_STATUS.DONE, true, 'done status'],
    [{ status: 'finished' }, JOB_STATUS.DONE, true, 'finished status'],
    [{ status: 'success' }, JOB_STATUS.DONE, true, 'success status'],
    [{ accepted: true, status: 'accepted' }, JOB_STATUS.PRINTING, false, 'accepted flag'],
    [{ accepted: true, status: 'printing' }, JOB_STATUS.PRINTING, false, 'printing status with accepted'],
    [{ accepted: true, status: 'sent' }, JOB_STATUS.PRINTING, false, 'sent status with accepted'],
    [{ status: 'failed' }, JOB_STATUS.FAILED, true, 'failed status'],
    [{ status: 'error' }, JOB_STATUS.FAILED, true, 'error status'],
    [{ status: 'rejected' }, JOB_STATUS.FAILED, true, 'rejected status'],
    [{ error: 'failed to connect' }, JOB_STATUS.FAILED, true, 'error field with failure keyword'],
    [{ error: 'rejected by server' }, JOB_STATUS.FAILED, true, 'error field with rejection keyword'],
    [{ accepted: true }, JOB_STATUS.PRINTING, false, 'accepted without status'],
    [{ jobId: '123' }, JOB_STATUS.PRINTING, false, 'response object without status'],
    [null, JOB_STATUS.FAILED, true, 'null result'],
    [undefined, JOB_STATUS.FAILED, true, 'undefined result'],
    [{}, JOB_STATUS.PRINTING, false, 'empty object'],
    [{ status: 'queued' }, JOB_STATUS.PRINTING, false, 'queued status'],
    [{ status: 'preparing' }, JOB_STATUS.PRINTING, false, 'preparing status'],
  ];
  
  for (const [result, expectedStatus, expectedTerminal, description] of testCases) {
    const decision = determineJobStatusFromResult(result);
    
    assert.strictEqual(decision.status, expectedStatus, 
      `${description}: expected status ${expectedStatus}, got ${decision.status}`);
    assert.strictEqual(decision.isTerminal, expectedTerminal,
      `${description}: expected isTerminal=${expectedTerminal}, got ${decision.isTerminal}`);
  }
  
  console.log(`  ✓ All ${testCases.length} status classification cases passed`);
}

function testTerminalStatusDetection() {
  console.log('\n  Testing terminal status detection...');
  
  const terminalStatuses = ['done', 'completed', 'failed', 'error', 'cancelled'];
  const nonTerminalStatuses = ['queued', 'printing', 'sending', 'preparing', 'sent', 'draft', 'validated'];
  
  for (const status of terminalStatuses) {
    assert.strictEqual(isTerminalJobStatus(status), true, 
      `${status} should be terminal`);
  }
  
  for (const status of nonTerminalStatuses) {
    assert.strictEqual(isTerminalJobStatus(status), false, 
      `${status} should NOT be terminal`);
  }
  
  console.log(`  ✓ Terminal status detection works for ${terminalStatuses.length} terminal and ${nonTerminalStatuses.length} non-terminal statuses`);
}

function testActiveStatusDetection() {
  console.log('\n  Testing active status detection...');
  
  const activeStatuses = ['sending', 'printing', 'preparing', 'sent'];
  const inactiveStatuses = ['queued', 'done', 'failed', 'completed', 'error', 'cancelled', 'draft'];
  
  for (const status of activeStatuses) {
    assert.strictEqual(isActiveJobStatus(status), true, 
      `${status} should be active`);
  }
  
  for (const status of inactiveStatuses) {
    assert.strictEqual(isActiveJobStatus(status), false, 
      `${status} should NOT be active`);
  }
  
  console.log(`  ✓ Active status detection works for ${activeStatuses.length} active and ${inactiveStatuses.length} inactive statuses`);
}

function testPastJobFiltering() {
  console.log('\n  Testing past job filter categories...');
  
  const PAST_JOB_FILTER_CATEGORIES = {
    COMPLETED: ['done', 'completed'],
    FAILED: ['failed', 'error'],
    CANCELLED: ['cancelled']
  };
  
  function classifyPastJobFilter(status) {
    const normalized = normalizeJobStatus(status);
    if (PAST_JOB_FILTER_CATEGORIES.CANCELLED.includes(normalized)) return 'cancelled';
    if (PAST_JOB_FILTER_CATEGORIES.FAILED.includes(normalized)) return 'failed';
    if (PAST_JOB_FILTER_CATEGORIES.COMPLETED.includes(normalized)) return 'completed';
    return null;
  }
  
  const testCases = [
    ['done', 'completed'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['error', 'failed'],
    ['cancelled', 'cancelled'],
    ['queued', null],
    ['printing', null],
    ['sending', null],
  ];
  
  for (const [status, expectedCategory] of testCases) {
    const category = classifyPastJobFilter(status);
    assert.strictEqual(category, expectedCategory,
      `${status} should be classified as ${expectedCategory}, got ${category}`);
  }
  
  console.log(`  ✓ Past job filtering works correctly`);
}

function testAcceptedVsFailedScenarios() {
  console.log('\n  Testing accepted vs failed scenarios...');
  
  // Scenario 1: Bridge accepts but doesn't complete immediately
  const acceptedResult = { accepted: true, status: 'accepted', jobId: '123' };
  const acceptedDecision = determineJobStatusFromResult(acceptedResult);
  assert.strictEqual(acceptedDecision.status, JOB_STATUS.PRINTING,
    'Accepted result without completion should be PRINTING');
  assert.strictEqual(acceptedDecision.isTerminal, false,
    'Accepted result should be non-terminal');
  
  // Scenario 2: Bridge returns explicit completion
  const completedResult = { status: 'completed', jobId: '123' };
  const completedDecision = determineJobStatusFromResult(completedResult);
  assert.strictEqual(completedDecision.status, JOB_STATUS.DONE,
    'Completed result should be DONE');
  assert.strictEqual(completedDecision.isTerminal, true,
    'Completed result should be terminal');
  
  // Scenario 3: Bridge throws exception
  // This is handled at a higher level, but the result would be null/undefined
  const errorDecision = determineJobStatusFromResult(null);
  assert.strictEqual(errorDecision.status, JOB_STATUS.FAILED,
    'Null result should be FAILED');
  assert.strictEqual(errorDecision.isTerminal, true,
    'Null result should be terminal');
  
  // Scenario 4: Bridge returns with error field containing failure keyword
  const errorResult = { error: 'failed: Connection refused' };
  const errorResultDecision = determineJobStatusFromResult(errorResult);
  assert.strictEqual(errorResultDecision.status, JOB_STATUS.FAILED,
    'Result with error field containing failure keyword should be FAILED');
  
  console.log('  ✓ Accepted vs failed scenarios work correctly');
}

function runAllTests() {
  console.log('\nJob Status Lifecycle Tests\n');
  
  try {
    testStatusClassification();
    testTerminalStatusDetection();
    testActiveStatusDetection();
    testPastJobFiltering();
    testAcceptedVsFailedScenarios();
    
    console.log('\n✓ All job status lifecycle tests passed\n');
    return true;
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runAllTests();
