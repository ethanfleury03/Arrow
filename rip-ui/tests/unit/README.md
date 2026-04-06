# app.js Unit Tests

## Setup

Tests run in a **jsdom** environment that emulates a browser (window, document, localStorage, canvas, etc.) so app.js can load and execute without Electron.

```
npm run test:app       # Run tests
npm run test:app:coverage  # Run tests (c8 coverage note below)
```

## Architecture

- `tests/unit/run.js` — jsdom harness. Creates a DOM, stubs all browser APIs (fetch, canvas, pdfjsLib, FileReader, etc.), intercepts app.js auto-boot (bind(), render(), startStatusPolling()), then loads app.js via `window.eval()` so top-level `function` declarations attach to `window`.
- `tests/unit/jsdom.setup.js` — thin re-export of `run.js` for `--require` compatibility.
- `tests/unit/app.test.js` — test cases (currently 38 passing).

## What gets tested

Pure utility functions with no DOM side effects:
- Math/conversion: `clamp`, `mmToIn`, `inToMm`, `formatInchesForInput`
- String: `escapeHtml`, `getBasename`
- Object: `deepClone`
- Jobs: `generateJobId`, `normalizeJobStatus`, `isTerminalJobStatus`, `isActiveJobStatus`
- Preflight: `isPreflightReadyEngineState`
- Geometry: `getPresetDimensionsMm`, `inferPresetAndOrientation`, `mergePlacement`
- Storage: `isLocalStorageAvailable`, `readJsonFromStorage`, `writeJsonToStorage`
- Errors: `getActionableError`, `hasSimulatedSignal`
- Board: `getBoardHitInfo`

## Coverage limitation

**c8 cannot track `window.eval()` scripts.** app.js is loaded via `window.eval()` inside jsdom, which runs in jsdom's V8 context. V8's native coverage API (used by c8) doesn't include scripts loaded via `window.eval()` when run inside jsdom.

Options to get real line coverage for app.js:
1. Refactor app.js to use `module.exports` (browser code → CommonJS), then c8 tracks it normally
2. Run tests in a real browser with a coverage tool (Istanbul/Playwright)
3. Use a jsdom-based coverage tool like `istanbul` with vm script instrumentation

For now: **tests verify correctness; coverage % is manually noted rather than auto-reported.**
