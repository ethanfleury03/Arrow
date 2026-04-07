#!/usr/bin/env node
/**
 * AI Test Generator — uses Ollama (codellama) to generate unit tests for app.js
 *
 * Usage:
 *   node scripts/ai-test-gen.js                    # generate tests for all untested functions
 *   node scripts/ai-test-gen.js --fn clamp        # generate for specific function
 *   node scripts/ai-test-gen.js --batch 5         # generate for next 5 untested
 *   node scripts/ai-test-gen.js --dry-run         # show what would be generated
 *
 * Prerequisites:
 *   - Ollama running:  brew services start ollama
 *   - Model pulled:    ollama pull codellama
 *   - Ollama URL:      http://localhost:11434 (override with OLLAMA_URL env)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'codellama';
const APP_JS = path.resolve(__dirname, '../src/app.js');
const TEST_FILE = path.resolve(__dirname, '../tests/unit/app.test.js');
const OUTPUT_FILE = path.resolve(__dirname, '../tests/unit/ai-generated.test.js');

// ── Parse command line ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  fn: null,
  batch: null,
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--fn' && args[i + 1]) flags.fn = args[i + 1];
  if (args[i] === '--batch' && args[i + 1]) flags.batch = parseInt(args[i + 1], 10);
}

// ── Read source files ────────────────────────────────────────────────────────
const appSource = fs.readFileSync(APP_JS, 'utf8');

// ── Extract all function declarations ────────────────────────────────────────
const FN_DECL = /^function\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
const functions = [];
let match;
while ((match = FN_DECL.exec(appSource)) !== null) {
  const name = match[1];
  const params = match[2].trim();
  const start = match.index;
  // Find the matching closing brace by counting braces
  let depth = 0, end = start;
  for (let i = start; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  functions.push({
    name,
    params,
    source: appSource.slice(start, end),
    line: appSource.slice(0, start).split('\n').length,
  });
}

console.log(`Found ${functions.length} functions in app.js`);

// ── Extract existing test function names ──────────────────────────────────────
const existingTestFns = new Set();
if (fs.existsSync(TEST_FILE)) {
  const testSource = fs.readFileSync(TEST_FILE, 'utf8');
  const testFnDecl = /^test\(['"]([^'"]+)['"]/gm;
  while ((match = testFnDecl.exec(testSource)) !== null) {
    existingTestFns.add(match[1]);
  }
}
console.log(`${existingTestFns.size} test names already in app.test.js`);

// ── Filter to untested functions ─────────────────────────────────────────────
// Only include functions that are testable without DOM (no document.getElementById,
// addEventListener, fetch, etc.) and have no more than 5 params
const DOM_PATTERNS = [
  'document\.', 'window\.', 'addEventListener', 'removeEventListener',
  'fetch(', 'XMLHttpRequest', 'localStorage\.setItem', 'localStorage\.getItem',
  'querySelector', 'createElement', 'appendChild', 'setInterval',
  'setTimeout(', 'getContext(', 'canvas', 'getBoundingClientRect',
  'addPdfToBoard', 'renderBoardPreview', 'renderLayoutPreview', 'renderBoardPdfList',
  'bindBoardControls', 'bindTopTabs', 'bindLeftSidebar', 'bindRightSidebar',
  'bindJobArrangeTabs', 'bindJobsTableTabs', 'syncLeftSidebarTabUI',
  'syncRightSidebarTabUI', 'syncTopTabUI', 'renderLayoutRuler',
  'render', 'startStatusPolling', 'hydrateRuntimeConfig',
  'hydratePersistedJobs', 'persistState', 'log(', 'renderBoardPdfPage',
];

function isTestable(fn) {
  if (fn.params.split(',').length > 4) return false;
  for (const pat of DOM_PATTERNS) {
    const re = new RegExp(pat.replace(/\(/g, '\\('));
    if (re.test(fn.source)) return false;
  }
  return true;
}

const testedFns = new Set(
  ['clamp', 'mmToIn', 'inToMm', 'escapeHtml', 'deepClone', 'generateJobId',
   'getBasename', 'normalizeJobStatus', 'isTerminalJobStatus', 'isActiveJobStatus',
   'isPreflightReadyEngineState', 'getPresetDimensionsMm', 'inferPresetAndOrientation',
   'mergePlacement', 'isLocalStorageAvailable', 'readJsonFromStorage',
   'writeJsonToStorage', 'getActionableError', 'hasSimulatedSignal',
   'getBoardHitInfo', 'removePdfFromBoard', 'updateBoardPlacement',
   'formatInchesForInput'].map(k => k.toLowerCase())
);

const candidates = functions.filter(fn => {
  if (testedFns.has(fn.name.toLowerCase())) return false;
  return isTestable(fn);
});

console.log(`${candidates.length} candidates are testable without DOM mocking`);
if (candidates.length > 0) {
  console.log('  Candidates:', candidates.map(f => f.name).join(', '));
}

// ── Select functions to generate ───────────────────────────────────────────────
let targetFns;
if (flags.fn) {
  targetFns = candidates.filter(f => f.name === flags.fn);
  if (!targetFns.length) {
    console.error(`Function '${flags.fn}' not found or not testable`);
    process.exit(1);
  }
} else if (flags.batch) {
  targetFns = candidates.slice(0, flags.batch);
} else {
  targetFns = candidates.slice(0, 10); // default: next 10
}

// ── Build prompt ─────────────────────────────────────────────────────────────
const existingTests = fs.existsSync(TEST_FILE)
  ? fs.readFileSync(TEST_FILE, 'utf8').slice(0, 4000)
  : '// No existing tests yet';

function buildPrompt(fn) {
  return `You are a JavaScript unit test generator. You write tests using Node.js assert.

EXISTING TEST FILE (format reference):
${existingTests}

FUNCTION TO TEST:
${fn.source}

Generate unit tests for the function \`${fn.name}\` with signature:
  ${fn.name}(${fn.params})

Rules:
1. Use Node.js \`assert\` module: const assert = require('node:assert');
2. Test format: function test(name, fn) { try { fn(); console.log('  ✓', name); } catch(e) { console.error('  ✗', name, e.message); process.exitCode=1; } }
3. Each test file exports: passed, failed counters and process.exit(1) if any failed
4. The function is available as a global (same V8 context as app.js loaded via jsdom)
5. state is also a global object — read state.artwork, state.jobs, state.config etc. to set up test fixtures
6. boardSelectedIndex is available as window.__boardSelectedIndex
7. Write 4-8 diverse test cases covering:
   - Normal happy-path cases
   - Edge cases (null, undefined, empty, zero, negative, very large values)
   - Type coercion (string numbers, etc.)
   - Boundary conditions
8. Do NOT mock DOM — only test pure logic or functions that operate on state
9. Return ONLY the test JavaScript code, no markdown fences, no explanations

Start directly with the test code.`;
}

// ── Call Ollama ──────────────────────────────────────────────────────────────
function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        num_predict: 2048,
      }
    });

    const url = new URL('/api/generate', OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          resolve(json.response || '');
        } catch (e) {
          reject(new Error(`Invalid JSON from Ollama: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', e => reject(new Error(`Ollama connection error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// ── Parse generated code ─────────────────────────────────────────────────────
function extractCode(response) {
  // Remove markdown fences if present
  let code = response.replace(/^```(?:javascript|js)?\n?/gm, '').replace(/```$/gm, '').trim();
  // Remove any leading explanation text before the first 'function test(' or 'const assert'
  const firstFn = code.indexOf('function test(');
  const firstAssert = code.indexOf('const assert');
  const start = Math.max(0, Math.min(firstFn !== -1 ? firstFn : Infinity, firstAssert !== -1 ? firstAssert : Infinity));
  if (start > 0) code = code.slice(start);
  return code;
}

// ── Main generation loop ─────────────────────────────────────────────────────
async function main() {
  const results = [];

  for (const fn of targetFns) {
    console.log(`\nGenerating tests for \`${fn.name}\` (line ${fn.line})...`);

    if (flags.dryRun) {
      console.log(`  [dry-run] Would generate for ${fn.name}(${fn.params})`);
      continue;
    }

    try {
      const prompt = buildPrompt(fn);
      const response = await callOllama(prompt);
      const code = extractCode(response);

      if (!code || code.length < 50) {
        console.error(`  ✗ Empty or too-short response for ${fn.name}`);
        results.push({ fn: fn.name, status: 'empty', code: '' });
        continue;
      }

      // Try to eval the code in a sandbox to check for syntax errors
      try {
        new Function(code);
        console.log(`  ✓ Generated ${code.split('\n').length} lines (syntax OK)`);
        results.push({ fn: fn.name, status: 'ok', code });
      } catch (e) {
        console.error(`  ✗ Syntax error in generated code: ${e.message}`);
        // Still save it with a .err extension for manual review
        results.push({ fn: fn.name, status: 'syntax-error', code });
        const errFile = OUTPUT_FILE.replace('.test.js', `-${fn.name}.err.js`);
        fs.writeFileSync(errFile, code);
        console.error(`  Saved to ${errFile} for review`);
      }
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      results.push({ fn: fn.name, status: 'error', error: e.message });
    }
  }

  // ── Write output file ─────────────────────────────────────────────────────
  const okResults = results.filter(r => r.status === 'ok');
  if (!flags.dryRun && okResults.length > 0) {
    const header = `/** AI-Generated Tests — ${new Date().toISOString().slice(0, 10)}
 * Generated by: scripts/ai-test-gen.js
 * Model: ${MODEL} @ ${OLLAMA_URL}
 * Functions: ${okResults.map(r => r.fn).join(', ')}
 */
'use strict';\n\n`;

    const combined = header + okResults.map(r => r.code).join('\n\n');

    // Append to existing or create new
    if (fs.existsSync(OUTPUT_FILE)) {
      const existing = fs.readFileSync(OUTPUT_FILE, 'utf8');
      fs.writeFileSync(OUTPUT_FILE, existing + '\n' + combined);
    } else {
      fs.writeFileSync(OUTPUT_FILE, combined);
    }

    console.log(`\nWrote ${okResults.length} test blocks to ${OUTPUT_FILE}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\nSummary:');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'empty' ? '⚠' : '✗';
    console.log(`  ${icon} ${r.fn}: ${r.status}`);
  }
  const ok = results.filter(r => r.status === 'ok').length;
  const total = results.length;
  console.log(`\n${ok}/${total} generated successfully`);

  if (ok < total) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
