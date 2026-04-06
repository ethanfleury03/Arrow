'use strict';

/**
 * Board composition unit tests
 *
 * Run with: npm run test:board
 */

const assert = require('node:assert');

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

// ── Get app globals from Node global scope ────────────────────────────────────
// Note: `state` is the same object reference as the `let state` in app.js
// (same V8 binding). Mutations to state.artwork.board.placements are visible here.
const { window } = global;
const {
  removePdfFromBoard, updateBoardPlacement,
  getBoardHitInfo
} = global;

// boardSelectedIndex is a `let` in app.js module scope — not observable from
// outside the eval. We verify boardSelectedIndex effects through observable
// state changes (DOM renders, state persistence, etc.) rather than direct reads.

function setUp() {
  // Reset board state before each test
  state.artwork.board = { placements: [] };
  state.artwork.boardMode = true;
}

// boardSelectedIndex is a `let` at app.js module scope.
// The eval harness exposes a configurable getter/setter as window.__boardSelectedIndex
// which reads/writes the actual let binding — use this to select a placement.
function setBoardIndex(val) {
  window.__boardSelectedIndex = val;
}

function makeFakeFile(name = 'test.pdf') {
  return { name, path: `/tmp/${name}`, size: 1024 };
}

// Stub pdfjsLib and renderBoardPdfPage for async addPdfToBoard tests
let _pdfResolve = null;
let _pdfReject = null;
window.pdfjsLib = {
  getDocument: () => ({
    promise: new Promise((resolve, reject) => {
      _pdfResolve = resolve;
      _pdfReject = reject;
    }),
  }),
  GlobalWorkerOptions: { workerSrc: '' },
};
window.renderBoardPdfPage = () => Promise.resolve('data:image/png;base64,fake');

console.log('\n  removePdfFromBoard');

test('removes the correct placement by index', () => {
  setUp();
  state.artwork.board.placements = [
    { fileName: 'a.pdf', xInches: 0.5 },
    { fileName: 'b.pdf', xInches: 1.0 },
    { fileName: 'c.pdf', xInches: 1.5 },
  ];

  removePdfFromBoard(1);

  const placements = state.artwork.board.placements;
  eq(placements.length, 2);
  eq(placements[0].fileName, 'a.pdf');
  eq(placements[1].fileName, 'c.pdf');
});

test('removes first placement correctly', () => {
  setUp();
  state.artwork.board.placements = [
    { fileName: 'first.pdf' },
    { fileName: 'second.pdf' },
  ];

  removePdfFromBoard(0);

  eq(state.artwork.board.placements.length, 1);
  eq(state.artwork.board.placements[0].fileName, 'second.pdf');
});

test('handles empty placements array without throwing', () => {
  setUp();
  state.artwork.board.placements = [];

  // Must not throw
  removePdfFromBoard(0);

  eq(state.artwork.board.placements.length, 0);
});

test('splices only one element', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'only.pdf' }];

  removePdfFromBoard(0);

  eq(state.artwork.board.placements.length, 0);
});

console.log('\n  updateBoardPlacement');

test('updates xInches field with numeric string', () => {
  setUp();
  state.artwork.board.placements = [
    { fileName: 'a.pdf', xInches: 0.5, yInches: 0.5, scale: 1, rotation: 0 },
  ];

  updateBoardPlacement(0, 'xInches', '2.5');

  eq(state.artwork.board.placements[0].xInches, 2.5);
});

test('updates scale field', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', scale: 1 }];

  updateBoardPlacement(0, 'scale', '0.5');

  eq(state.artwork.board.placements[0].scale, 0.5);
});

test('updates rotation field', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', rotation: 0 }];

  updateBoardPlacement(0, 'rotation', '90');

  eq(state.artwork.board.placements[0].rotation, 90);
});

test('parses float values correctly', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', xInches: 0 }];

  updateBoardPlacement(0, 'xInches', '1.25');

  eq(state.artwork.board.placements[0].xInches, 1.25);
});

test('converts non-numeric string to 0', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', xInches: 5 }];

  updateBoardPlacement(0, 'xInches', 'abc');

  eq(state.artwork.board.placements[0].xInches, 0);
});

test('handles negative values', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', xInches: 0 }];

  updateBoardPlacement(0, 'xInches', '-1.5');

  eq(state.artwork.board.placements[0].xInches, -1.5);
});

test('silently ignores invalid index', () => {
  setUp();
  state.artwork.board.placements = [{ fileName: 'a.pdf', xInches: 5 }];

  updateBoardPlacement(99, 'xInches', '10');

  // Original value unchanged
  eq(state.artwork.board.placements[0].xInches, 5);
});

test('silently ignores empty placements array', () => {
  setUp();
  state.artwork.board.placements = [];

  // Must not throw
  updateBoardPlacement(0, 'xInches', '1');
});

console.log('\n  getBoardHitInfo');

test('returns null when board geometry not set', () => {
  setUp();
  delete window.__boardGeom;

  const hit = getBoardHitInfo(100, 100);
  eq(hit, null);
});

test('returns null when no placements and no board geometry', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [];

  const hit = getBoardHitInfo(100, 100);
  eq(hit, null);
});

test('returns outside when click is left of board', () => {
  setUp();
  window.__boardGeom = {
    boardX: 100, boardY: 50, boardPxW: 600, boardPxH: 400,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [];

  // x=50 is left of boardX=100
  const hit = getBoardHitInfo(50, 200);
  eq(hit.type, 'outside');
});

test('returns outside when click is above board', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 100, boardPxW: 800, boardPxH: 400,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [];

  // y=50 is above boardY=100
  const hit = getBoardHitInfo(200, 50);
  eq(hit.type, 'outside');
});

test('returns body hit for a placement at canvas origin', () => {
  setUp();
  // board starts at 0,0; PDF at 0,0 with small scale so it fits in canvas
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // scale=0.1: 612pt * 0.1 = 61.2pt = 0.85in = 21.6mm → 216px wide
  // scale=0.1: 792pt * 0.1 = 79.2pt = 1.1in = 27.9mm → 279px tall
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Hit at center of small PDF: (100, 100) — well within 0-216, 0-279
  const hit = getBoardHitInfo(100, 100);
  eq(hit.type, 'body');
  eq(hit.index, 0);
});

test('returns body hit for last placement when two overlap at same position', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // Two PDFs stacked at same position; last one in array should be hit first
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 1, pageWidthPt: 612, pageHeightPt: 792 },
    { xInches: 0, yInches: 0, scale: 1, pageWidthPt: 612, pageHeightPt: 792 },
  ];

  // PDF at 0,0 with scale=1 is 2159px wide × 2796px tall (huge, overflows canvas)
  // Hit at canvas (100, 100) which is within the PDF bounds
  const hit = getBoardHitInfo(100, 100);
  eq(hit.type, 'body');
  eq(hit.index, 1); // topmost (last in array)
});

test('returns handle hit for NW corner of selected placement', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // PDF at origin, small scale so it fits
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // boardSelectedIndex = 0 (selected), NW handle is at (boardX + xIn*25.4*mmToPx, ...)
  // = (0 + 0*25.4*10, 0 + 0*25.4*10) = (0, 0)
  // Select this placement so handle checks apply
  setBoardIndex(0);
  // HANDLE_SIZE = 8, so hit at (3, 3) should be within handle
  const hit = getBoardHitInfo(3, 3);
  eq(hit.type, 'handle');
  eq(hit.handleName, 'nw');
  eq(hit.index, 0);
});

test('returns handle hit for SE corner', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // PDF at origin with scale=0.1: 216px wide, 279px tall
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Select this placement
  setBoardIndex(0);
  // SE handle: (px + pw, py + ph) = (216, 279)
  const hit = getBoardHitInfo(216, 279);
  eq(hit.type, 'handle');
  eq(hit.handleName, 'se');
});

test('returns handle hit for NE corner', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Select this placement
  setBoardIndex(0);
  // NE handle: (px + pw, py) = (216, 0)
  const hit = getBoardHitInfo(216, 0);
  eq(hit.type, 'handle');
  eq(hit.handleName, 'ne');
});

test('returns handle hit for SW corner', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Select this placement
  setBoardIndex(0);
  // SW handle: (px, py + ph) = (0, 279)
  const hit = getBoardHitInfo(0, 279);
  eq(hit.type, 'handle');
  eq(hit.handleName, 'sw');
});

test('returns body when clicking selected PDF but not on any handle', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // PDF at origin with scale=0.1: 216×279px
  state.artwork.board.placements = [
    { xInches: 0, yInches: 0, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Hit at center of PDF (far from all handles)
  const hit = getBoardHitInfo(100, 100);
  eq(hit.type, 'body');
  eq(hit.index, 0);
});

test('returns null when clicking empty area inside board bounds', () => {
  setUp();
  window.__boardGeom = {
    boardX: 50, boardY: 50, boardPxW: 600, boardPxH: 400,
    mmToPx: 10, cw: 1000, ch: 800
  };
  state.artwork.board.placements = [];

  // Click at (200, 200) — within board bounds but no placements
  const hit = getBoardHitInfo(200, 200);
  eq(hit, null);
});

test('returns body for placement offset from origin', () => {
  setUp();
  window.__boardGeom = {
    boardX: 0, boardY: 0, boardPxW: 800, boardPxH: 600,
    mmToPx: 10, cw: 1000, ch: 800
  };
  // PDF at 1in right, 0.5in down, scale=0.1
  // px = 0 + 1*25.4*10 = 254, py = 0 + 0.5*25.4*10 = 127
  state.artwork.board.placements = [
    { xInches: 1, yInches: 0.5, scale: 0.1, pageWidthPt: 612, pageHeightPt: 792 }
  ];

  // Hit at center of PDF: (254 + 108, 127 + 139) ≈ (362, 266)
  const hit = getBoardHitInfo(300, 200);
  eq(hit.type, 'body');
  eq(hit.index, 0);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n  Board Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
