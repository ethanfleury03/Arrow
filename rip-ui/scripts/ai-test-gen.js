#!/usr/bin/env node
/**
 * AI Test Generator — uses Ollama (codellama) to generate unit tests for app.js
 *
 * Usage:
 *   node scripts/ai-test-gen.js              # generate for next 10 untested functions
 *   node scripts/ai-test-gen.js --fn clamp  # generate for specific function
 *   node scripts/ai-test-gen.js --batch 5    # generate for next 5
 *   node scripts/ai-test-gen.js --dry-run    # preview what would be generated
 *
 * Prerequisites:
 *   - Ollama running:  brew services start ollama
 *   - Model pulled:    ollama pull codellama
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'codellama';
const APP_JS = path.resolve(__dirname, '../src/app.js');
const TEST_FILE = path.resolve(__dirname, '../tests/unit/app.test.js');
const OUTPUT_FILE = path.resolve(__dirname, '../tests/unit/ai-generated.test.js');

// ── Parse command line ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = { dryRun: false, fn: null, batch: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') flags.dryRun = true;
  if (args[i] === '--fn' && args[i + 1]) flags.fn = args[i + 1];
  if (args[i] === '--batch' && args[i + 1]) flags.batch = parseInt(args[i + 1], 10);
}

// ── Read app.js source ────────────────────────────────────────────────────────
const appSource = fs.readFileSync(APP_JS, 'utf8');

// ── Extract function declarations ──────────────────────────────────────────────
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
console.log(`Found ${functions.length} functions in app.js`);

// ── Known tested functions ─────────────────────────────────────────────────────
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
  // Already generated (skip on re-run)
  'getPresetDimensionsForOrientation', 'getStatusFreshnessMs',
]);

// ── Testability filter ─────────────────────────────────────────────────────────
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
  return !EXCLUDE_PATTERNS.some(p => p.test(fn.source));
}

const candidates = functions.filter(fn => !testedFns.has(fn.name) && isTestable(fn));
console.log(`${candidates.length} testable candidates (excluding ${testedFns.size} already tested)`);
console.log('  Next:', candidates.slice(0, 5).map(f => f.name).join(', '));

// ── Select targets ────────────────────────────────────────────────────────────
let targets;
if (flags.fn) {
  targets = candidates.filter(f => f.name === flags.fn);
  if (!targets.length) { console.error(`'${flags.fn}' not found or not testable`); process.exit(1); }
} else if (flags.batch) {
  targets = candidates.slice(0, flags.batch);
} else {
  targets = candidates.slice(0, 10);
}

// ── Prompt builder ────────────────────────────────────────────────────────────
const existingSnippet = fs.existsSync(TEST_FILE) ? fs.readFileSync(TEST_FILE, 'utf8').slice(0, 2000) : '// no existing tests yet';

function buildPrompt(fn) {
  return `You write JavaScript unit tests using Node.js assert. Copy this exact format:

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch(e) { failed++; console.error('  ✗', name, e.message); }
}
function eq(a, e) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error('Expected '+JSON.stringify(e)+' Got '+JSON.stringify(a)); }
function assertOk(v) { if (!v) throw new Error('Expected truthy, got ' + JSON.stringify(v)); }

FUNCTION:
${fn.source}

Write 4-8 tests for \`${fn.name}(${fn.params})\` covering:
- Happy path cases
- Edge cases: null, undefined, 0, -1, negative, very large, NaN, Infinity
- Type coercion: string numbers, empty string, boolean strings
- Boundary conditions

Rules:
- Use ONLY Node.js built-ins (no DOM, no fetch, no network)
- Function is available as a global
- \`state\` global is available for fixture setup
- \`window.__boardSelectedIndex\` for board selection
- Replace process.exit(1) with process.exitCode = 1 so multiple blocks can run together
- Return ONLY the JavaScript code, NO markdown fences
- Start directly with: let passed`;
}

// ── Call Ollama ──────────────────────────────────────────────────────────────
function ollama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.2, num_predict: 2048 } });
    const url = new URL('/api/generate', OLLAMA_URL);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new Error(`Ollama ${res.statusCode}`)); return; }
          try { resolve(JSON.parse(data).response); }
          catch (e) { reject(new Error('Bad JSON')); }
        });
      });
    req.on('error', e => reject(e));
    req.write(body); req.end();
  });
}

// ── Parse code ───────────────────────────────────────────────────────────────
function extractCode(response) {
  let code = response.replace(/^```(?:javascript|js)?\n?/gm, '').replace(/```$/gm, '').trim();

  // Strip any leading explanation text
  const firstLet = code.indexOf('let passed');
  if (firstLet > 0) code = code.slice(firstLet);

  // If code starts with 'let passed' (possibly with 'let ' before it), extract just the variable
  // declarations and prepend them cleanly
  if (!/^let passed/.test(code)) {
    // Try to find 'let passed =' and use that as the start
    const match = code.match(/let passed = \d+/);
    if (match) {
      const declEnd = code.indexOf(';', match.index);
      const decl = code.slice(match.index, declEnd + 1); // 'let passed = 0, failed = 0;'
      const rest = code.slice(declEnd + 1);
      code = 'let passed = 0, failed = 0;\n' + rest;
    } else {
      code = 'let passed = 0, failed = 0;\n' + code;
    }
  }

  return code;
}

// ── Write block ────────────────────────────────────────────────────────────────
function writeBlock(fnName, code, status) {
  const header = `// ═══ ${fnName} ═══ ${status}\n`;
  const footer = '\nif (failed > 0) { console.error(`  [${fnName}: ${failed} failures]`); process.exitCode = 1; }\n\n';
  const content = header + code + footer;
  if (fs.existsSync(OUTPUT_FILE)) {
    fs.appendFileSync(OUTPUT_FILE, content);
  } else {
    fs.writeFileSync(OUTPUT_FILE,
      `// AI-Generated — ${new Date().toISOString().slice(0,10)} | ${MODEL} | ${OLLAMA_URL}\n` +
      `'use strict';\n\n` + content
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!flags.dryRun && fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);

  let ok = 0, bad = 0;

  for (const fn of targets) {
    process.stdout.write(`Generating \`${fn.name}\`... `);

    if (flags.dryRun) { console.log('[dry-run]'); continue; }

    try {
      const raw = await ollama(buildPrompt(fn));
      let code = extractCode(raw);

      if (!code || code.length < 30) {
        console.log('⚠ empty'); bad++; continue;
      }

      // Replace bare process.exit(1) with exitCode
      code = code.replace(/process\.exit\(1\)/g, 'process.exitCode = 1');

      // Fix missing let/const for eq/assertOk
      if (!/^let passed/.test(code)) {
        code = 'let passed = 0, failed = 0;\n' + code;
      }

      // Syntax check
      try { new Function(code); }
      catch (e) {
        // Try to auto-fix common issues
        const fixed = code
          .replace(/,\s*$/gm, '')           // trailing commas
          .replace(/^function test\(['"](.+)['"]/gm, "function test('$1'")
          .replace(/console\.error\(['"]\\\s*✗/g, "console.error('  ✗");
        try { new Function(fixed); code = fixed; }
        catch (e2) {
          console.log(`✗ syntax: ${e.message.slice(0, 60)}`);
          writeBlock(fn.name, code, `SYNTAX_ERR: ${e.message.slice(0, 40)}`);
          bad++; continue;
        }
      }

      writeBlock(fn.name, code, 'generated');
      console.log(`✓ (${code.split('\n').length} lines)`);
      ok++;
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 80)}`);
      bad++;
    }
  }

  console.log(`\n─── ${ok} ok, ${bad} failed ───`);
  if (bad > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
