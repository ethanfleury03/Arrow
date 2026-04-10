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
    this._classes = new Set();
    this.classList = {
      add: cls => this._classes.add(cls),
      remove: cls => this._classes.delete(cls),
      toggle: cls => this._classes.has(cls) ? this._classes.delete(cls) : this._classes.add(cls),
      contains: cls => this._classes.has(cls)
    };
    this.style = {};
    this.children = [];
  }

  setAttribute(name, value) {
    this._attributes[name] = String(value);
  }

  getAttribute(name) {
    return this._attributes[name] ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    return child;
  }

  addEventListener() {}
  removeEventListener() {}

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

function createHarness() {
  const elements = {};
  const ids = [
    'logs',
    'jobTable',
    'queue',
    'statusCards',
    'configPreview',
    'pipelinePreview',
    'controls',
    'btnAddJob',
    'btnDiscover',
    'btnRunSimulation',
    'btnRunFault',
    'btnRunRecovery',
    'btnExportState',
    'btnResetState',
    'btnAlignLeft',
    'btnAlignRight',
    'btnToggleDiscoveryMode',
    'discoveryModeHint',
    'eligibilityPreview'
  ];
  ids.forEach(id => {
    elements[id] = new Element(id);
  });

  const local = new Map();
  const timerQueue = [];

  const context = {
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
      timerQueue.push(fn);
      return timerQueue.length;
    },
    clearTimeout: () => {},
    setInterval: () => 999,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
    console,
    window: null,
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

  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(APP_JS, 'utf8');
  vm.runInContext(source, context, { filename: APP_JS });

  function flushTimers(limit = 200) {
    let i = 0;
    while (timerQueue.length && i < limit) {
      const fn = timerQueue.shift();
      fn();
      i += 1;
    }
    if (i >= limit) throw new Error('Timer flush limit exceeded');
  }

  function getState() {
    return JSON.parse(local.get('rip-ui-prototype-state-v1'));
  }

  return { elements, flushTimers, getState };
}

function assertSnapshot(name, payload) {
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(payload, expected);
}

(function run() {
  const h1 = createHarness();
  h1.elements.btnAddJob.click();
  const s1 = h1.getState();

  const snap1 = {
    counter: s1.counter,
    jobIds: s1.jobs.map(j => j.id),
    queueTail: s1.queue.slice(-1)[0],
    queueDepth: s1.status.queueDepth
  };
  assertSnapshot('add-job', snap1);

  const h2 = createHarness();
  h2.elements.btnRunSimulation.click();
  h2.flushTimers();
  const s2 = h2.getState();

  const snap2 = {
    lastResult: s2.simulator.lastResult,
    sequenceStep: s2.status.sequenceStep,
    pipeline: s2.status.pipeline,
    jobStatuses: s2.jobs.map(j => j.status)
  };
  assertSnapshot('run-simulation', snap2);

  const h3 = createHarness();
  h3.elements.btnRunFault.click();
  h3.flushTimers();
  const s3 = h3.getState();

  const snap3 = {
    lastResult: s3.simulator.lastResult,
    sequenceStep: s3.status.sequenceStep,
    pipeline: s3.status.pipeline,
    jobStatuses: s3.jobs.map(j => j.status)
  };
  assertSnapshot('fault-scenario', snap3);


  const h4 = createHarness();
  h4.elements.btnRunRecovery.click();
  h4.flushTimers();
  const s4 = h4.getState();

  const snap4 = {
    lastResult: s4.simulator.lastResult,
    sequenceStep: s4.status.sequenceStep,
    pipeline: s4.status.pipeline,
    jobStatuses: s4.jobs.map(j => j.status)
  };
  assertSnapshot('recovery-scenario', snap4);

  const h5 = createHarness();
  h5.elements.btnAlignLeft.click();
  h5.elements.btnAlignRight.click();
  const s5 = h5.getState();

  const snap5 = {
    alignX: s5.artwork.placement.alignX,
    hasPresetState: Object.prototype.hasOwnProperty.call(s5.ui || {}, 'arrangePresets')
  };
  assertSnapshot('preset-apply', snap5);

  const h6 = createHarness();
  h6.elements.btnToggleDiscoveryMode.click();
  const s6 = h6.getState();

  const snap6 = {
    readOnlyDiscovery: s6.config.readOnlyDiscovery,
    hint: h6.elements.discoveryModeHint.textContent
  };
  assertSnapshot('discovery-mode-toggle', snap6);

  console.log('PASS ui-harness deterministic snapshots');
})();
