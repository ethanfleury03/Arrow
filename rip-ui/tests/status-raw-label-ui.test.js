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
    this.classList = { add() {} };
  }

  set innerHTML(value) {
    this._innerHTML = value;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll() {
    return [];
  }
}

async function runCase(statusPayload) {
  const elements = {};
  const ids = [
    'logs', 'jobTable', 'queue', 'statusCards', 'configPreview', 'pipelinePreview', 'controls',
    'liveStatusCards', 'systemStateValue'
  ];
  ids.forEach(id => { elements[id] = new Element(id); });

  const local = new Map();

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
      getItem(k) { return local.has(k) ? local.get(k) : null; },
      setItem(k, v) { local.set(k, String(v)); }
    },
    setTimeout,
    setInterval(fn) {
      // Execute once immediately for deterministic fallback poll behavior.
      Promise.resolve().then(() => fn());
      return 1;
    },
    clearInterval() {},
    Blob: class {},
    URL: { createObjectURL() { return 'blob://det'; }, revokeObjectURL() {} },
    window: {
      ripBridge: {
        async getStatus() {
          return statusPayload;
        }
      },
      addEventListener() {}
    }
  };

  vm.createContext(context);
  const source = fs.readFileSync(APP_JS, 'utf8');
  vm.runInContext(source, context, { filename: APP_JS });

  await new Promise(resolve => setTimeout(resolve, 10));

  const state = JSON.parse(local.get(STORAGE_KEY));
  return { state, elements };
}

(async function run() {
  const six = await runCase({
    engineState: 'READY',
    engineStateRawNumeric: 6,
    engineStateRawLabel: 'PRIMED_IDLE',
    engineStateCanonical: 'PRIMED_IDLE',
    queueLength: 0,
    faults: [],
    timestamp: new Date().toISOString()
  });
  assert.equal(six.state.liveStatus.engineStateRawLabel, 'PRIMED_IDLE');
  assert.equal(six.elements.systemStateValue.textContent, 'PRIMED_IDLE');

  const seven = await runCase({
    engineState: 'IDLE',
    engineStateRawNumeric: 7,
    engineStateRawLabel: 'SERVICING',
    engineStateCanonical: 'SERVICING',
    queueLength: 0,
    faults: [],
    timestamp: new Date().toISOString()
  });
  assert.equal(seven.state.liveStatus.engineStateRawLabel, 'SERVICING');
  assert.equal(seven.elements.systemStateValue.textContent, 'SERVICING');

  const unknownNumeric = await runCase({
    engineState: 'UNKNOWN',
    engineStateRawNumeric: 99,
    queueLength: 0,
    faults: [],
    timestamp: new Date().toISOString()
  });
  assert.equal(unknownNumeric.state.liveStatus.engineStateRawLabel, 'STATE_99');
  assert.equal(unknownNumeric.elements.systemStateValue.textContent, 'STATE_99');

  console.log('PASS status raw label UI mapping');
})().catch(error => {
  console.error('FAIL status raw label UI mapping');
  console.error(error);
  process.exit(1);
});
