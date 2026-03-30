const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'src', 'app.js');

const source = fs.readFileSync(APP_JS, 'utf8');

console.log('\nPDF guard regression checks\n');

// Guard exists in file intake path
assert.match(
  source,
  /Only PDF files can be loaded for printing/i,
  'Expected non-PDF intake guard message in handleArtworkFile()'
);

// Guard exists in send flow path
assert.match(
  source,
  /Only PDF files can be sent to the printer/i,
  'Expected PDF-only send guard message in handleSendJobCopies()'
);

// Send/copy buttons are gated by PDF-loaded status
assert.match(
  source,
  /function updateSendAndCopyButtons\(/,
  'Expected updateSendAndCopyButtons() helper'
);
assert.match(
  source,
  /state\.artwork\.loaded\s*&&\s*\/\\\.pdf\$\/i\.test\(state\.artwork\.name\)/,
  'Expected send/copy button gating on loaded PDF artwork'
);

console.log('PASS pdf-guard regression checks');
