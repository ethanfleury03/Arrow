#!/usr/bin/env node
/**
 * AI Test Generator — uses Ollama (codellama) to generate unit tests for app.js
 *
 * Usage:
 *   node scripts/ai-test-gen.js              # generate for next 10 untested
 *   node scripts/ai-test-gen.js --fn clamp  # specific function
 *   node scripts/ai-test-gen.js --batch 5    # next 5
 *   node scripts/ai-test-gen.js --dry-run    # preview targets
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Config ─────────────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'codellama';
const APP_JS = path.resolve(__dirname, '../src/app.js');
const TEST_FILE = path.resolve(__dirname, '../tests/unit/app.test.js');
const OUTPUT_FILE = path.resolve(__dirname, '../tests/unit/ai-generated.test.js');

// ── Parse CLI ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = { dryRun: false, fn: null, batch: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') flags.dryRun = true;
  if (args[i] === '--fn' && args[i + 1]) flags.fn = args[i + 1];
  if (args[i] === '--batch' && args[i + 1]) flags.batch = parseInt(args[i + 1], 10);
}

// ── Read app.js ───────────────────────────────────────────────────────────────
const appSource = fs.readFileSync(APP_JS, 'utf8');

// ── Extract function declarations ─────────────────────────────────────────────
const FN_DECL = /^function\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
const functions = [];
let m;
while ((m = FN_DECL.exec(appSource)) !== null) {
  const name = m[1], params = m[2].trim(), start = m.index;
  let depth = 0, end = start;
  for (let i = start; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}') { if (--depth === 0) { end = i + 1; break; } }
  }
  functions.push({ name, params, source: appSource.slice(start, end), line: appSource.slice(0, start).split('\n').length });
}
console.log('Found', functions.length, 'functions in app.js');

// ── Known tested functions ────────────────────────────────────────────────────
const testedFns = new Set([
  // app.test.js
  'clamp', 'mmToIn', 'inToMm', 'escapeHtml', 'deepClone', 'generateJobId',
  'getBasename', 'normalizeJobStatus', 'isTerminalJobStatus', 'isActiveJobStatus',
  'isPreflightReadyEngineState', 'getPresetDimensionsMm', 'inferPresetAndOrientation',
  'mergePlacement', 'isLocalStorageAvailable', 'readJsonFromStorage',
  'writeJsonToStorage', 'getActionableError', 'hasSimulatedSignal',
  'getBoardHitInfo', 'removePdfFromBoard', 'updateBoardPlacement',
  'formatInchesForInput',
  // board.test.js
  'toggleBoardMode', 'addPdfToBoard', 'renderBoardPdfList',
  // Already generated
  'getPresetDimensionsForOrientation', 'getStatusFreshnessMs', 'updateSequenceStatus',
]);

// ── Inaccessible refs filter ─────────────────────────────────────────────────
// These module-level consts can't be accessed from generated test file scope
const INACCESSIBLE_REFS = ['INITIAL_STATE', 'PAGE_SIZE_PRESETS', 'HANDLE_SIZE',
  'READ_ONLY_ACTIONS', 'JOB_STATUS', 'BOX_FACE_MAP'];
function hasInaccessibleRef(fn) {
  return INACCESSIBLE_REFS.some(ref => new RegExp('\\b' + ref + '\\b').test(fn.source));
}

// ── DOM/async patterns that can't be tested without heavy mocking ──────────────
const EXCLUDE_PATTERNS = [
  /document\./, /window\./, /addEventListener/, /removeEventListener/,
  /fetch\(/, /XMLHttpRequest/, /querySelector/, /createElement/, /appendChild/,
  /setInterval/, /setTimeout/, /getContext/, /getBoundingClientRect/,
  /renderBoardPreview/, /renderLayoutPreview/, /renderBoardPdfList/,
  /renderLayoutRuler/, /bindBoard/, /bindTop/, /bindLeft/, /bindRight/,
  /bindJobArrange/, /bindJobsTable/,
  /syncLeftSidebarTabUI/, /syncRightSidebarTabUI/, /syncTopTabUI/,
  /startStatusPolling/, /hydrateRuntimeConfig/, /hydratePersistedJobs/,
  /persistState/, /log\(/, /renderBoardPdfPage/, /render\(/,
  /openSendJobDialog/, /closeSendJobDialog/, /runDiscovery/,
  /pressControl/, /runPipeline/, /runFault/, /runRecovery/,
  /applyPageSize/, /applyPlacement/, /handleImageFile/, /handleArtworkFile/,
];

function isTestable(fn) {
  if (fn.params.split(',').length > 4) return false;
  if (hasInaccessibleRef(fn)) return false;
  // Exclude functions that read state.artwork or state.ui directly
  if (/state\.(artwork|ui|simulator|config)\./.test(fn.source)) return false;
  return !EXCLUDE_PATTERNS.some(p => p.test(fn.source));
}

const candidates = functions.filter(fn => !testedFns.has(fn.name) && isTestable(fn));
console.log(candidates.length, 'testable candidates (excluding', testedFns.size, 'already tested)');
console.log('  Next:', candidates.slice(0, 5).map(f => f.name).join(', '));

// ── Select targets ────────────────────────────────────────────────────────────
let targets;
if (flags.fn) {
  targets = candidates.filter(f => f.name === flags.fn);
  if (!targets.length) { console.error("'" + flags.fn + "' not found or not testable"); process.exit(1); }
} else if (flags.batch) {
  targets = candidates.slice(0, flags.batch);
} else {
  targets = candidates.slice(0, 10);
}

// ── Prompt ────────────────────────────────────────────────────────────────────
function buildPrompt(fn) {
  const existingSnippet = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf8').slice(0, 2000) : '';
  return 'You write JavaScript unit tests using Node.js assert. Copy this exact format:\n\n' +
    'let passed = 0, failed = 0;\n' +
    'function test(name, fn) {\n' +
    '  try { fn(); passed++; console.log("  \\u2713", name); }\n' +
    '  catch(e) { failed++; console.error("  \\u2717", name, e.message); }\n' +
    '}\n' +
    'function eq(a, e) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error("Expected "+JSON.stringify(e)+" Got "+JSON.stringify(a)); }\n' +
    'function assertOk(v) { if (!v) throw new Error("Expected truthy, got " + JSON.stringify(v)); }\n\n' +
    (existingSnippet ? 'EXISTING TESTS (copy style):\n' + existingSnippet + '\n\n' : '') +
    'FUNCTION:\n' + fn.source + '\n\n' +
    'Write 4-8 tests for `' + fn.name + '(' + fn.params + ')` covering:\n' +
    '- Happy path cases\n' +
    '- Edge cases: null, undefined, 0, -1, negative, very large, NaN, Infinity\n' +
    '- Type coercion: string numbers, empty string, boolean strings\n' +
    '- Boundary conditions\n\n' +
    'Rules:\n' +
    '- Use ONLY Node.js built-ins (no DOM, no fetch, no network)\n' +
    '- Function is available as a global\n' +
    '- `state` global is available for fixture setup\n' +
    '- `window.__boardSelectedIndex` for board selection\n' +
    '- Do NOT reference INITIAL_STATE, PAGE_SIZE_PRESETS, HANDLE_SIZE, READ_ONLY_ACTIONS, or JOB_STATUS directly — they are module-level consts not accessible here. Test observable behavior instead.\n' +
    '- Replace process.exit(1) with process.exitCode = 1 so multiple blocks run together\n' +
    '- Return ONLY JavaScript code, NO markdown fences, NO explanations\n' +
    '- Start with: let passed';
}

// ── Call Ollama ──────────────────────────────────────────────────────────────
function ollama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.2, num_predict: 4096 } });
    const url = new URL('/api/generate', OLLAMA_URL);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new Error('Ollama ' + res.statusCode)); return; }
          try { resolve(JSON.parse(data).response); }
          catch (e) { reject(new Error('Bad JSON')); }
        });
      });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── Parse generated code ──────────────────────────────────────────────────────
function extractCode(response) {
  let code = response.replace(/^```(?:javascript|js)?\n?/gm, '').replace(/```$/gm, '').trim();

  // Find the FIRST `let passed` and keep everything from there.
  const firstLet = code.indexOf('let passed');
  if (firstLet >= 0) code = code.slice(firstLet);
  else code = 'let passed = 0, failed = 0;\n' + code;

  // Ollama sometimes emits TWO blocks in one response (e.g. clamp tests + second function tests).
  // Detect a second `let passed =` that is NOT inside a string and truncate before it.
  const firstDeclEnd = code.indexOf('let passed') + 30;
  const secondLet = code.indexOf('let passed', firstDeclEnd);
  if (secondLet > 0) {
    const before = code.slice(Math.max(0, secondLet - 10), secondLet);
    if (!/['"]/.test(before)) {
      code = code.slice(0, secondLet);
    }
  }

  return code;
}

// ── Write block to output ─────────────────────────────────────────────────────
function writeBlock(fnName, code, status) {
  // Use var so multiple blocks coexist in same module scope
  const safeCode = code.replace(/^let passed = /m, 'var passed = ').replace(/^let failed = /m, 'var failed = ');

  const header = '// ═══ ' + fnName + ' ═══ ' + status + '\n';
  // Use string concatenation not template literal to avoid fnName scope issues
  const footer = '\nif (failed > 0) { console.error("  [BLOCK FAILED: ' + fnName + ']"); process.exitCode = 1; }\n\n';
  const content = header + safeCode + footer;

  if (fs.existsSync(OUTPUT_FILE)) {
    fs.appendFileSync(OUTPUT_FILE, content);
  } else {
    fs.writeFileSync(OUTPUT_FILE,
      '// AI-Generated — ' + new Date().toISOString().slice(0,10) + ' | ' + MODEL + ' | ' + OLLAMA_URL + '\n' +
      "'use strict';\n\n" + content
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!flags.dryRun && fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);

  let ok = 0, bad = 0;

  for (const fn of targets) {
    process.stdout.write('Generating `' + fn.name + '`... ');

    if (flags.dryRun) { console.log('[dry-run]'); continue; }

    try {
      const raw = await ollama(buildPrompt(fn));
      let code = extractCode(raw);

      if (!code || code.length < 30) { console.log('⚠ empty response'); bad++; continue; }

      // Replace bare process.exit(1)
      code = code.replace(/process\.exit\(1\)/g, 'process.exitCode = 1');

      // Syntax check
      try { new Function(code); }
      catch (e) {
        // Auto-fix trailing commas and missing semicolons
        const fixed = code
          .replace(/,\s*$/gm, '')
          .replace(/process\.exitCode = 1(?!\s*;)/g, 'process.exitCode = 1;');
        try { new Function(fixed); code = fixed; }
        catch (e2) {
          console.log('✗ syntax: ' + e2.message.slice(0, 60));
          writeBlock(fn.name, code, 'SYNTAX_ERR: ' + e2.message.slice(0, 40));
          bad++; continue;
        }
      }

      writeBlock(fn.name, code, 'generated');
      console.log('✓ (' + code.split('\n').length + ' lines)');
      ok++;
    } catch (e) {
      console.log('✗ ' + e.message.slice(0, 80));
      bad++;
    }
  }

  console.log('\n─── ' + ok + ' ok, ' + bad + ' failed ───');
  if (bad > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
