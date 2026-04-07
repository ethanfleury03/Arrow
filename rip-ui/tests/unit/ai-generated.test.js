// AI-Generated — 2026-04-07 | codellama | http://localhost:11434
'use strict';

// ═══ normalizeRotationDeg ═══ generated
var passed = 0;
var failed = 0;

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

console.log('\n  normalizeRotationDeg');

test('normalizeRotationDeg returns 0 for null', () => {
  eq(normalizeRotationDeg(null), 0);
});

test('normalizeRotationDeg returns 0 for undefined', () => {
  eq(normalizeRotationDeg(undefined), 0);
});

test('normalizeRotationDeg returns 0 for 0', () => {
  eq(normalizeRotationDeg(0), 0);
});

test('normalizeRotationDeg returns -180 for negative number', () => {
  eq(normalizeRotationDeg(-5), -180);
});

test('normalizeRotationDeg returns 180 for very large number', () => {
  eq(normalizeRotationDeg(99999999999999999999999), 180);
});

test('normalizeRotationDeg returns 0 for NaN', () => {
  eq(normalizeRotationDeg(NaN), 0);
});

test('normalizeRotationDeg returns 0 for Infinity', () => {
  eq(normalizeRotationDeg(Infinity), 0);
});

test('normalizeRotationDeg returns 180 for string "180"', () => {
  eq(normalizeRotationDeg("180"), 180);
});

test('normalizeRotationDeg returns -180 for string "-180"', () => {
  eq(normalizeRotationDeg("-180"), -180);
});

test('normalizeRotationDeg returns 0 for empty string', () => {
  eq(normalizeRotationDeg(""), 0);
});

test('normalizeRotationDeg returns 0 for boolean true', () => {
  eq(normalizeRotationDeg(true), 0);
});

test('normalizeRotationDeg returns 0 for boolean false', () => {
  eq(normalizeRotationDeg(false), 0);
});
if (failed > 0) { console.error("  [BLOCK FAILED: normalizeRotationDeg]"); process.exitCode = 1; }

