const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'src', 'app.js');
const STORAGE_KEY = 'rip-ui-prototype-state-v1';

class Element {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this._innerHTML = '';
    this.onclick = null;
    this.dataset = {};
    this._buttons = [];
    this.classList = { add() {} };
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (this.id === 'controls') {
      const names = [...String(value).matchAll(/data-c="([^"]+)"/g)].map(m => m[1]);
      this._buttons = names.map(name => {
        const b = new Element('button');
        b.dataset.c = name;
        return b;
      });
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    if (this.id === 'controls' && selector === 'button') return this._buttons;
    return [];
  }

  click() {
    if (typeof this.onclick === 'function') this.onclick();
  }
}

function runWithState(seedState) {
  const ids = [
    'logs', 'jobTable', 'queue', 'statusCards', 'configPreview', 'pipelinePreview', 'controls',
    'eligibilityPreview', 'preflightPreview', 'btnRunPreflight'
  ];
  const elements = {};
  ids.forEach(id => {
    elements[id] = new Element(id);
  });

  const local = new Map();
  local.set(STORAGE_KEY, JSON.stringify(seedState));

  const context = {
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = new Element(id);
        return elements[id];
      }
    },
    localStorage: {
      getItem(k) {
        return local.has(k) ? local.get(k) : null;
      },
      setItem(k, v) {
        local.set(k, String(v));
      }
    },
    setTimeout(fn) {
      fn();
      return 1;
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    Blob: class {},
    URL: { createObjectURL() { return 'blob://det'; }, revokeObjectURL() {} }
  };

  vm.createContext(context);
  const source = fs.readFileSync(APP_JS, 'utf8');
  vm.runInContext(source, context, { filename: APP_JS });

  elements.btnRunPreflight.click();
  return JSON.parse(local.get(STORAGE_KEY));
}

const staleFailState = {
  artwork: { loaded: true, name: 'proof.pdf' },
  config: { host: '192.168.111.2', pollIntervalMs: 1000 },
  connectionTests: { command: 'OK 2026-03-13T00:00:00.000Z', data: 'OK 2026-03-13T00:00:00.000Z', event: 'NOT-TESTED' },
  liveStatus: {
    running: true,
    engineState: 'UNKNOWN',
    queueLength: 0,
    faults: ['WARN_MEDIA_LOW'],
    lastUpdate: new Date(Date.now() - 60000).toISOString(),
    source: 'live'
  }
};

const failResult = runWithState(staleFailState);
assert.equal(failResult.preflight.passed, false);
assert.ok(failResult.preflight.reasons.some(r => r.includes('Live status is stale')));
assert.ok(failResult.preflight.reasons.some(r => r.includes('Engine state not ready')));
assert.ok(failResult.preflight.reasons.some(r => r.includes('active faults')));

const passState = {
  artwork: { loaded: true, name: 'proof.pdf' },
  config: { host: '192.168.111.2', pollIntervalMs: 1000 },
  connectionTests: { command: 'OK 2026-03-13T00:00:00.000Z', data: 'OK 2026-03-13T00:00:00.000Z', event: 'NOT-TESTED' },
  liveStatus: {
    running: true,
    engineState: 'READY',
    queueLength: 1,
    faults: [],
    lastUpdate: new Date(Date.now() - 1000).toISOString(),
    source: 'live'
  }
};

const passResult = runWithState(passState);
assert.equal(passResult.preflight.passed, true);
assert.deepStrictEqual(passResult.preflight.reasons, []);

console.log('PASS preflight status-aware gating');
