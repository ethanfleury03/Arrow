const assert = require('node:assert');
const { getPresetDimensionsForOrientation } = global;

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

// Test cases:
test('getPresetDimensionsForOrientation returns null for invalid preset', () => {
  const result = getPresetDimensionsForOrientation(null, 'landscape');
  eq(result, null);
});

test('getPresetDimensionsForOrientation returns null for invalid orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', null);
  eq(result, null);
});

test('getPresetDimensionsForOrientation returns correct dimensions for landscape preset', () => {
  const result = getPresetDimensionsForOrientation('a4', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for portrait preset', () => {
  const result = getPresetDimensionsForOrientation('a4', 'portrait');
  assert.ok(Math.abs(result.widthMm - 297) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 210) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for landscape preset with zero width', () => {
  const result = getPresetDimensionsForOrientation('a4', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for portrait preset with zero height', () => {
  const result = getPresetDimensionsForOrientation('a4', 'portrait');
  assert.ok(Math.abs(result.widthMm - 297) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 210) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for landscape preset with negative width', () => {
  const result = getPresetDimensionsForOrientation('a4', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for portrait preset with negative height', () => {
  const result = getPresetDimensionsForOrientation('a4', 'portrait');
  assert.ok(Math.abs(result.widthMm - 297) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 210) < 0.0001);
});

// Test coverage:
test('getPresetDimensionsForOrientation returns correct dimensions for all presets', () => {
  const presets = ['a4', 'letter', 'legal'];
  const orientations = ['landscape', 'portrait'];
  for (const preset of presets) {
    for (const orientation of orientations) {
      const result = getPresetDimensionsForOrientation(preset, orientation);
      assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
      assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
    }
  }
});

// Type coercion:
test('getPresetDimensionsForOrientation returns correct dimensions for string preset', () => {
  const result = getPresetDimensionsForOrientation('a4', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for string orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for number preset', () => {
  const result = getPresetDimensionsForOrientation(1, 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for number orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', 1);
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

// Boundary conditions:
test('getPresetDimensionsForOrientation returns correct dimensions for very large preset', () => {
  const result = getPresetDimensionsForOrientation(100, 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for very large orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', 100);
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

// Edge cases:
test('getPresetDimensionsForOrientation returns correct dimensions for empty preset', () => {
  const result = getPresetDimensionsForOrientation('', 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for empty orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', '');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for zero preset', () => {
  const result = getPresetDimensionsForOrientation(0, 'landscape');
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math.abs(result.heightMm - 297) < 0.0001);
});

test('getPresetDimensionsForOrientation returns correct dimensions for zero orientation', () => {
  const result = getPresetDimensionsForOrientation('a4', 0);
  assert.ok(Math.abs(result.widthMm - 210) < 0.0001);
  assert.ok(Math