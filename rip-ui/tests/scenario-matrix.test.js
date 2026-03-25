const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'tests', 'snapshots', 'scenario-matrix.json');

const scenarios = [
  {
    id: 'happy-path',
    steps: ['clear', 'initialise', 'prepare', 'start', 'finish', 'shutdown'],
    hasQueuedJob: true,
    expected: { result: 'PASS', faultCode: null }
  },
  {
    id: 'prepare-with-empty-queue',
    steps: ['clear', 'initialise', 'prepare'],
    hasQueuedJob: false,
    expected: { result: 'FAIL', faultCode: 'ERR_NO_JOB_AT_QUEUE_HEAD' }
  },
  {
    id: 'start-before-prepare',
    steps: ['clear', 'initialise', 'start'],
    hasQueuedJob: true,
    expected: { result: 'FAIL', faultCode: 'ERR_NOT_READY' }
  },
  {
    id: 'double-start-busy',
    steps: ['clear', 'initialise', 'prepare', 'start', 'start'],
    hasQueuedJob: true,
    expected: { result: 'FAIL', faultCode: 'ERR_BUSY' }
  },
  {
    id: 'fault-then-recover',
    steps: ['clear', 'initialise', 'prepare', 'clear', 'initialise', 'prepare', 'start', 'finish'],
    hasQueuedJob: false,
    queueOverrides: { 5: true },
    allowRecoverFromNoJob: true,
    expected: { result: 'PASS', faultCode: null }
  },
  {
    id: 'init-when-not-off',
    steps: ['initialise'],
    startEngineState: 'READY',
    hasQueuedJob: true,
    expected: { result: 'FAIL', faultCode: 'ERR_ENGINE_MUST_BE_OFF' }
  }
];

function runScenario(def) {
  const state = {
    engine: def.startEngineState || 'OFF',
    printing: false,
    hasQueuedJob: Boolean(def.hasQueuedJob),
    phase: 'EXPECT_CLEAR'
  };

  for (let idx = 0; idx < def.steps.length; idx += 1) {
    const step = def.steps[idx];

    if (def.queueOverrides && Object.prototype.hasOwnProperty.call(def.queueOverrides, idx)) {
      state.hasQueuedJob = Boolean(def.queueOverrides[idx]);
    }

    if (step === 'initialise' && state.engine !== 'OFF') {
      return { result: 'FAIL', faultCode: 'ERR_ENGINE_MUST_BE_OFF' };
    }

    if (step === 'prepare' && !state.hasQueuedJob) {
      if (def.allowRecoverFromNoJob) {
        state.phase = 'EXPECT_CLEAR';
        continue;
      }
      return { result: 'FAIL', faultCode: 'ERR_NO_JOB_AT_QUEUE_HEAD' };
    }

    if (step === 'start' && state.printing) {
      return { result: 'FAIL', faultCode: 'ERR_BUSY' };
    }

    if (step === 'start' && state.phase !== 'EXPECT_START') {
      return { result: 'FAIL', faultCode: 'ERR_NOT_READY' };
    }

    if (state.phase === 'EXPECT_CLEAR' && step !== 'clear') {
      return { result: 'FAIL', faultCode: 'ERR_SEQUENCE' };
    }

    if (state.phase === 'EXPECT_INIT' && step !== 'initialise') {
      return { result: 'FAIL', faultCode: 'ERR_SEQUENCE' };
    }

    if (state.phase === 'EXPECT_PREPARE' && step !== 'prepare') {
      return { result: 'FAIL', faultCode: 'ERR_SEQUENCE' };
    }

    if (state.phase === 'EXPECT_FINISH_OR_SHUTDOWN' && !['finish', 'shutdown'].includes(step)) {
      return { result: 'FAIL', faultCode: 'ERR_SEQUENCE' };
    }

    if (step === 'clear') {
      state.engine = 'OFF';
      state.printing = false;
      state.phase = 'EXPECT_INIT';
      continue;
    }

    if (step === 'initialise') {
      state.engine = 'READY';
      state.phase = 'EXPECT_PREPARE';
      continue;
    }

    if (step === 'prepare') {
      state.phase = 'EXPECT_START';
      continue;
    }

    if (step === 'start') {
      state.printing = true;
      state.phase = 'EXPECT_FINISH_OR_SHUTDOWN';
      continue;
    }

    if (step === 'finish') {
      state.printing = false;
      state.engine = 'IDLE';
      return { result: 'PASS', faultCode: null };
    }

    if (step === 'shutdown') {
      state.engine = 'OFF';
      return { result: 'PASS', faultCode: null };
    }
  }

  return { result: 'FAIL', faultCode: 'ERR_INCOMPLETE' };
}

const matrix = scenarios.map(s => ({ id: s.id, outcome: runScenario(s) }));

for (const s of scenarios) {
  const actual = matrix.find(m => m.id === s.id).outcome;
  assert.deepStrictEqual(actual, s.expected, `Scenario ${s.id} mismatch`);
}

const expectedSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
assert.deepStrictEqual(matrix, expectedSnapshot);

console.log('PASS scenario-matrix deterministic outcomes');
