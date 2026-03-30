const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'src', 'app.js');
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

class Element {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this._innerHTML = '';
    this.onclick = null;
    this.dataset = {};
    this._attributes = {};
    this._buttons = [];
    this.value = '';
    this.disabled = false;
    this.title = '';
    this.style = {};
    this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }

  setAttribute(name, value) { this._attributes[name] = String(value); }
  getAttribute(name) { return this._attributes[name] ?? null; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { const i = this.children.indexOf(child); if (i !== -1) this.children.splice(i, 1); return child; }

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

  addEventListener() {}

  click() {
    if (typeof this.onclick === 'function') this.onclick();
  }
}

function assertSnapshot(name, payload) {
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(payload, expected);
}

function createHarness() {
  const elements = {};
  const ids = [
    'logs', 'jobTable', 'queue', 'statusCards', 'configPreview', 'pipelinePreview', 'controls',
    'btnAddJob', 'btnDiscover', 'btnRunSimulation', 'btnRunFault', 'btnRunRecovery', 'btnExportState', 'btnResetState',
    'btnStartPolling', 'btnStopPolling', 'btnExportConfig', 'btnTestCommand', 'btnTestEvent', 'btnTestData',
    'modeBadge', 'liveStatusCards', 'simulationBadge', 'commandError', 'connectionPreview',
    'cfgHost', 'cfgCommandPort', 'cfgEventPort', 'cfgDataPort', 'cfgIps', 'cfgPoll',
    'configImport', 'loadedFileName', 'pdfPageSize'
  ];

  ids.forEach(id => {
    elements[id] = new Element(id);
  });

  const local = new Map();
  const timeoutQueue = [];
  const intervals = new Map();
  let intervalId = 0;

  const fixedIso = '2026-03-13T14:00:00.000Z';
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length) {
        super(...args);
      } else {
        super(fixedIso);
      }
    }
    static now() {
      return new Date(fixedIso).getTime();
    }
  }

  const ripBridge = {
    async getStatus() {
      return {
        engineState: 'READY',
        queueLength: 2,
        faults: [],
        timestamp: fixedIso
      };
    },
    async runCommand({ command }) {
      return { ok: true, command };
    },
    async testEndpoint({ kind }) {
      return { ok: true, kind };
    }
  };

  const context = {
    Date: FixedDate,
    window: { ripBridge },
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = new Element(id);
        return elements[id];
      },
      createElement(tag) {
        return new Element(tag);
      }
    },
    localStorage: {
      getItem(k) {
        return local.has(k) ? local.get(k) : null;
      },
      setItem(k, v) {
        local.set(k, String(v));
      },
      removeItem(k) {
        local.delete(k);
      }
    },
    setTimeout: fn => {
      timeoutQueue.push(fn);
      return timeoutQueue.length;
    },
    clearTimeout: () => {},
    setInterval: fn => {
      intervalId += 1;
      intervals.set(intervalId, fn);
      return intervalId;
    },
    clearInterval: id => {
      intervals.delete(id);
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
    console,
    navigator: { userAgent: 'test' },
    fetch: () => Promise.reject(new Error('no network in test')),
    confirm: () => true,
    prompt: () => '1',
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    URL: {
      createObjectURL() {
        return 'blob://deterministic';
      },
      revokeObjectURL() {}
    }
  };

  context.window = { ...context, ripBridge };
  vm.createContext(context);
  const source = fs.readFileSync(APP_JS, 'utf8');
  vm.runInContext(source, context, { filename: APP_JS });

  function flushTimers(limit = 200) {
    let i = 0;
    while (timeoutQueue.length && i < limit) {
      const fn = timeoutQueue.shift();
      fn();
      i += 1;
    }
    if (i >= limit) throw new Error('Timer flush limit exceeded');
  }

  function tickIntervals() {
    for (const fn of intervals.values()) fn();
  }

  function getState() {
    return JSON.parse(local.get('rip-ui-prototype-state-v1'));
  }

  return { elements, flushTimers, tickIntervals, getState };
}

(async function run() {
  const h = createHarness();

  h.elements.btnStartPolling.click();
  await Promise.resolve();
  h.tickIntervals();
  await Promise.resolve();

  h.elements.btnTestCommand.click();
  await Promise.resolve();

  h.elements.btnTestEvent.click();
  await Promise.resolve();

  h.elements.btnTestData.click();
  await Promise.resolve();

  const ctrlBtns = h.elements.controls.querySelectorAll('button');
  ctrlBtns.find(b => b.dataset.c === 'clear')?.click();
  await Promise.resolve();
  ctrlBtns.find(b => b.dataset.c === 'initialise')?.click();
  await Promise.resolve();
  ctrlBtns.find(b => b.dataset.c === 'prepare')?.click();
  await Promise.resolve();
  ctrlBtns.find(b => b.dataset.c === 'start')?.click();
  await Promise.resolve();

  h.flushTimers();

  const s = h.getState();
  const snap = {
    source: s.liveStatus.source,
    running: s.liveStatus.running,
    engineState: s.liveStatus.engineState,
    queueLength: s.liveStatus.queueLength,
    connectionTests: s.connectionTests,
    sequenceStep: s.status.sequenceStep,
    pipeline: s.status.pipeline,
    commandError: s.commandError || '',
    historyHead: s.simulator.history.slice(0, 3)
  };

  assertSnapshot('hookup-acceptance', snap);
  console.log('PASS hookup-harness deterministic acceptance snapshot');
})();
