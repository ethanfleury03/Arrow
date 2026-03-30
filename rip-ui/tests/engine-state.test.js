const assert = require('node:assert/strict');
const {
  ENGINE_STATE_VALUE_TO_NAME,
  ENGINE_STATE_NAME_TO_UI,
  parseEngineStateNumberFromRaw,
  extractEmbeddedJsonRawFromOutput,
  hasSimulatedSignal,
  resolveEngineState
} = require('../bridge/engine-state');

function testMaps() {
  assert.equal(ENGINE_STATE_VALUE_TO_NAME[1], 'OFF');
  assert.equal(ENGINE_STATE_VALUE_TO_NAME[10], 'PRINTING');
  assert.equal(ENGINE_STATE_VALUE_TO_NAME[6], 'PRIMED_IDLE');
  assert.equal(ENGINE_STATE_NAME_TO_UI['PRIMED_IDLE'], 'READY');
  assert.equal(ENGINE_STATE_NAME_TO_UI['PRINTING'], 'PRINTING');
  assert.equal(ENGINE_STATE_NAME_TO_UI['POST_JOB'], 'IDLE');
}

function testParseEngineStateNumber() {
  assert.equal(parseEngineStateNumberFromRaw('engineStatus.state = 6'), 6);
  assert.equal(parseEngineStateNumberFromRaw('engineStatus: { state: 10 }'), 10);
  assert.equal(parseEngineStateNumberFromRaw('state = 1'), 1);
  assert.equal(parseEngineStateNumberFromRaw('no match here'), null);
  assert.equal(parseEngineStateNumberFromRaw(null), null);
  assert.equal(parseEngineStateNumberFromRaw(''), null);
}

function testExtractEmbeddedJson() {
  const text = 'some log\n{"raw": "engineStatus.state = 10"}\nmore log';
  assert.equal(extractEmbeddedJsonRawFromOutput(text), 'engineStatus.state = 10');
  assert.equal(extractEmbeddedJsonRawFromOutput('no json here'), null);
  assert.equal(extractEmbeddedJsonRawFromOutput('{"raw": ""}'), null);
  assert.equal(extractEmbeddedJsonRawFromOutput(null), null);
}

function testHasSimulatedSignal() {
  assert.equal(hasSimulatedSignal(true), true);
  assert.equal(hasSimulatedSignal(false), false);
  assert.equal(hasSimulatedSignal('this is simulated'), true);
  assert.equal(hasSimulatedSignal('no-op result'), true);
  assert.equal(hasSimulatedSignal('real result'), false);
  assert.equal(hasSimulatedSignal({ simulated: true }), true);
  assert.equal(hasSimulatedSignal({ dryRun: true }), true);
  assert.equal(hasSimulatedSignal({ real: true }), false);
  assert.equal(hasSimulatedSignal([false, 'shimmed']), true);
  assert.equal(hasSimulatedSignal(null), false);
}

function testResolveEngineState() {
  const ready = resolveEngineState({ engineStateRawNumeric: 6 });
  assert.equal(ready.engineState, 'READY');
  assert.equal(ready.canonical, 'PRIMED_IDLE');
  assert.equal(ready.numeric, 6);

  const printing = resolveEngineState({ engineStateRawLabel: 'PRINTING' });
  assert.equal(printing.engineState, 'PRINTING');

  const fromDetails = resolveEngineState({
    details: { engineState: 'OFF' }
  });
  assert.equal(fromDetails.engineState, 'OFF');

  const unknown = resolveEngineState({});
  assert.equal(unknown.engineState, 'UNKNOWN');

  const fromOutput = resolveEngineState({
    details: { productInfo: { output: 'line\n{"raw": "engineStatus.state = 10"}\nend' } }
  });
  assert.equal(fromOutput.engineState, 'PRINTING');
  assert.equal(fromOutput.numeric, 10);
}

(function run() {
  testMaps();
  console.log('  ✓ testMaps');
  testParseEngineStateNumber();
  console.log('  ✓ testParseEngineStateNumber');
  testExtractEmbeddedJson();
  console.log('  ✓ testExtractEmbeddedJson');
  testHasSimulatedSignal();
  console.log('  ✓ testHasSimulatedSignal');
  testResolveEngineState();
  console.log('  ✓ testResolveEngineState');
  console.log('engine-state.test: PASS');
})();
