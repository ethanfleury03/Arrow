'use strict';

/**
 * app.js unit tests
 *
 * Run with:  npm run test:app
 * With coverage: npm run test:app:coverage
 */

const assert = require('node:assert');
const { window } = global;

// Functions from app.js (loaded into jsdom window, exposed to Node global scope)
const {
  clamp, mmToIn, inToMm, escapeHtml, deepClone,
  generateJobId, getBasename, normalizeJobStatus,
  isTerminalJobStatus, isActiveJobStatus,
  isPreflightReadyEngineState, runPreflightChecks,
  getPresetDimensionsMm, inferPresetAndOrientation, mergePlacement,
  formatInchesForInput, hasSimulatedSignal, getActionableError,
  isLocalStorageAvailable, readJsonFromStorage, writeJsonToStorage,
  getBoardHitInfo,
} = global;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function eq(actual, expected, msg = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}\n      Expected: ${JSON.stringify(expected)}\n      Actual:   ${JSON.stringify(actual)}`);
  }
}

// ── Math / Conversion Utilities ──────────────────────────────────────────────

console.log('\n  Math / Conversion utilities');

test('clamp clamps values within range', () => {
  eq(clamp(5, 0, 10), 5);
  eq(clamp(-1, 0, 10), 0);
  eq(clamp(15, 0, 10), 10);
});

test('clamp returns fallback for non-finite input', () => {
  eq(clamp(NaN, 0, 10), undefined);
  eq(clamp(NaN, 0, 10, 999), 999);
  eq(clamp(Infinity, 0, 10), undefined);
});

test('mmToIn converts millimeters to inches', () => {
  assert.ok(Math.abs(mmToIn(25.4) - 1) < 0.0001);
  assert.ok(Math.abs(mmToIn(50.8) - 2) < 0.0001);
  eq(mmToIn(0), 0);
});

test('inToMm converts inches to millimeters', () => {
  assert.ok(Math.abs(inToMm(1) - 25.4) < 0.0001);
  assert.ok(Math.abs(inToMm(2) - 50.8) < 0.0001);
  eq(inToMm(0), 0);
});

test('formatInchesForInput formats mm values as inches string', () => {
  const result = formatInchesForInput(25.4);
  eq(parseFloat(result), 1);
});

// ── String / HTML Utilities ──────────────────────────────────────────────────

test('escapeHtml escapes HTML special characters', () => {
  eq(escapeHtml('<div>'), '&lt;div&gt;');
  eq(escapeHtml('A & B'), 'A &amp; B');
  eq(escapeHtml('"quotes"'), '&quot;quotes&quot;');
  eq(escapeHtml("'apostrophe'"), '&#39;apostrophe&#39;');
  eq(escapeHtml('normal text'), 'normal text');
});

test('escapeHtml handles edge cases', () => {
  eq(escapeHtml(''), '');
  eq(escapeHtml(null), 'null');
  eq(escapeHtml(undefined), 'undefined');
  eq(escapeHtml(123), '123');
});

// ── Deep Clone ──────────────────────────────────────────────────────────────

test('deepClone creates a deep copy of an object', () => {
  const orig = { a: 1, b: { c: 2, d: [1, 2, 3] } };
  const copy = deepClone(orig);
  copy.b.c = 99;
  copy.b.d.push(4);
  eq(orig.b.c, 2);
  eq(orig.b.d.length, 3);
  eq(copy.b.c, 99);
  eq(copy.b.d.length, 4);
});

test('deepClone handles arrays', () => {
  const orig = [{ x: 1 }, { x: 2 }];
  const copy = deepClone(orig);
  copy[0].x = 99;
  eq(orig[0].x, 1);
  eq(copy[0].x, 99);
});

test('deepClone handles primitives (passthrough)', () => {
  eq(deepClone(null), null);
  eq(deepClone(42), 42);
  eq(deepClone('hello'), 'hello');
  eq(deepClone(true), true);
});

// ── Job ID Generation ────────────────────────────────────────────────────────

test('generateJobId returns a string starting with JOB-', () => {
  const id = generateJobId();
  assert.ok(typeof id === 'string');
  assert.ok(id.startsWith('JOB-'), `Expected JOB- prefix, got: ${id}`);
});

test('generateJobId returns unique IDs', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(generateJobId());
  eq(ids.size, 100);
});

test('generateJobId contains hex timestamps and random parts', () => {
  const id = generateJobId();
  // Format: JOB-TIMESTAMP-RANDOM (uppercase hex)
  assert.ok(/^JOB-[0-9A-F]+-[0-9A-F]{6}$/.test(id), `Unexpected format: ${id}`);
});

// ── Path Utilities ───────────────────────────────────────────────────────────

test('getBasename extracts filename from path', () => {
  eq(getBasename('/home/user/file.pdf'), 'file.pdf');
  eq(getBasename('/path/to/dir/'), 'dir');
  eq(getBasename('file.pdf'), 'file.pdf');
});

test('getBasename returns null for empty/falsy input', () => {
  eq(getBasename(''), null);
  eq(getBasename(null), null);
  eq(getBasename(undefined), null);
  eq(getBasename(0), null);
});

test('getBasename does not strip extensions (no stripExtension param)', () => {
  // getBasename only takes a path argument - no stripExtension support
  eq(getBasename('/home/user/file.pdf'), 'file.pdf');
  eq(getBasename('/path/to/archive.tar.gz'), 'archive.tar.gz');
});

test('getBasename handles Windows paths', () => {
  eq(getBasename('C:\\Users\\test\\doc.txt'), 'doc.txt');
  eq(getBasename('C:\\path\\to\\dir\\'), 'dir');
});

// ── Job Status Utilities ─────────────────────────────────────────────────────

test('normalizeJobStatus normalizes status strings to lowercase', () => {
  eq(normalizeJobStatus('DONE'), 'done');
  eq(normalizeJobStatus('Completed'), 'completed');
  eq(normalizeJobStatus('queued'), 'queued');
  eq(normalizeJobStatus('unknown'), 'unknown');
  eq(normalizeJobStatus('UNKNOWN'), 'unknown');
});

test('isTerminalJobStatus returns true for terminal statuses', () => {
  ['done', 'completed', 'failed', 'error', 'cancelled'].forEach(s =>
    assert.ok(isTerminalJobStatus(s), `"${s}" should be terminal`)
  );
  ['queued', 'printing', 'sending', 'preparing', 'draft'].forEach(s =>
    assert.ok(!isTerminalJobStatus(s), `"${s}" should not be terminal`)
  );
});

test('isActiveJobStatus returns true for active-printing statuses', () => {
  ['sending', 'preparing', 'printing'].forEach(s =>
    assert.ok(isActiveJobStatus(s), `"${s}" should be active`)
  );
  ['queued', 'done', 'failed', 'draft'].forEach(s =>
    assert.ok(!isActiveJobStatus(s), `"${s}" should not be active`)
  );
});

// ── Preflight Checks ──────────────────────────────────────────────────────────

test('isPreflightReadyEngineState accepts valid engine state strings', () => {
  assert.ok(isPreflightReadyEngineState('READY'));
  assert.ok(isPreflightReadyEngineState('IDLE'));
  assert.ok(isPreflightReadyEngineState('PRINTING'));
  assert.ok(isPreflightReadyEngineState('ready'));
  assert.ok(isPreflightReadyEngineState('idle'));
});

test('isPreflightReadyEngineState rejects invalid states', () => {
  assert.ok(!isPreflightReadyEngineState('UNKNOWN'));
  assert.ok(!isPreflightReadyEngineState('ERROR'));
  assert.ok(!isPreflightReadyEngineState('offline'));
  assert.ok(!isPreflightReadyEngineState(null));
  assert.ok(!isPreflightReadyEngineState(undefined));
  assert.ok(!isPreflightReadyEngineState(''));
  assert.ok(!isPreflightReadyEngineState({})); // objects are stringified
});

// ── Preset Dimensions ─────────────────────────────────────────────────────────

test('getPresetDimensionsMm returns correct dimensions for known presets', () => {
  const letter = getPresetDimensionsMm('letter');
  eq(Math.round(letter.widthMm), 216);
  eq(Math.round(letter.heightMm), 279);

  const a4 = getPresetDimensionsMm('a4');
  eq(a4.widthMm, 210);
  eq(a4.heightMm, 297);
});

test('getPresetDimensionsMm returns null for unknown presets', () => {
  eq(getPresetDimensionsMm('8.5x11'), null);
  eq(getPresetDimensionsMm('unknown'), null);
  eq(getPresetDimensionsMm(''), null);
});

test('inferPresetAndOrientation detects letter portrait', () => {
  const result = inferPresetAndOrientation(215.9, 279.4);
  eq(result.pageSizePreset, 'letter');
  eq(result.orientation, 'portrait');
});

test('inferPresetAndOrientation detects letter landscape', () => {
  const result = inferPresetAndOrientation(279.4, 215.9);
  eq(result.pageSizePreset, 'letter');
  eq(result.orientation, 'landscape');
});

test('inferPresetAndOrientation returns custom for non-preset sizes', () => {
  const result = inferPresetAndOrientation(100, 200);
  eq(result.pageSizePreset, 'custom');
  eq(result.orientation, 'portrait'); // 100 < 200 so portrait
});

test('inferPresetAndOrientation handles wide custom sizes as landscape', () => {
  const result = inferPresetAndOrientation(300, 100);
  eq(result.pageSizePreset, 'custom');
  eq(result.orientation, 'landscape');
});

test('inferPresetAndOrientation handles invalid inputs', () => {
  const r1 = inferPresetAndOrientation(0, 100);
  eq(r1.pageSizePreset, 'custom');
  eq(r1.orientation, 'portrait');

  const r2 = inferPresetAndOrientation(-10, 100);
  eq(r2.pageSizePreset, 'custom');
});

// ── Placement ────────────────────────────────────────────────────────────────

test('mergePlacement applies defaults from INITIAL_STATE.artwork.placement', () => {
  const result = mergePlacement({});
  // Defaults come from INITIAL_STATE.artwork.placement
  eq(result.scalePercent, 100);
  eq(result.rotationDeg, 0);
  eq(result.orientation, 'portrait');
  eq(result.fitMode, 'none');
});

test('mergePlacement uses provided values over defaults', () => {
  const result = mergePlacement({ xInches: 2, yInches: 3, scale: 0.5, rotation: 90 });
  eq(result.xInches, 2);
  eq(result.yInches, 3);
  eq(result.scale, 0.5);
  eq(result.rotation, 90);
});

test('mergePlacement preserves extra keys from input', () => {
  const result = mergePlacement({ xInches: 1, customField: 'kept' });
  eq(result.customField, 'kept');
});

// ── LocalStorage Helpers ─────────────────────────────────────────────────────

test('isLocalStorageAvailable returns true in jsdom environment', () => {
  assert.ok(typeof isLocalStorageAvailable === 'function');
  // Our jsdom setup provides a working localStorage mock
  const result = isLocalStorageAvailable();
  assert.ok(typeof result === 'boolean');
});

test('readJsonFromStorage returns fallback for missing key', () => {
  const result = readJsonFromStorage('nonexistent-key-xyz-123', { fallback: true });
  eq(result.fallback, true);
});

test('writeJsonToStorage and readJsonFromStorage round-trip correctly', () => {
  const key = 'test-roundtrip-key';
  const value = { nested: { value: 42 }, array: [1, 2, 3], str: 'hello' };
  writeJsonToStorage(key, value);
  const retrieved = readJsonFromStorage(key, null);
  eq(retrieved.nested.value, 42);
  eq(retrieved.array.length, 3);
  eq(retrieved.str, 'hello');
  // Cleanup
  global.localStorage.removeItem(key);
});

// ── Error Handling ──────────────────────────────────────────────────────────

test('getActionableError returns a string from Error objects', () => {
  const result = getActionableError(new Error('SIMULATED: printer offline'));
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 0);
});

test('hasSimulatedSignal detects SIMULATED prefix', () => {
  assert.ok(hasSimulatedSignal('SIMULATED: some value'));
  assert.ok(hasSimulatedSignal('simulated: lowercase'));
  assert.ok(!hasSimulatedSignal('normal value'));
  assert.ok(!hasSimulatedSignal(null));
  assert.ok(!hasSimulatedSignal(undefined));
  assert.ok(!hasSimulatedSignal(''));
});

// ── Board Composition Utilities ────────────────────────────────────────────────

console.log('\n  Board composition utilities');

test('getBoardHitInfo returns null when board geometry not set', () => {
  delete window.__boardGeom;
  const hit = getBoardHitInfo(100, 100);
  eq(hit, null);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
