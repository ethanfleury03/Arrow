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
    this.tabIndex = 0;
    this.value = '';
    this.hidden = false;
    this.listeners = new Map();
    this.style = {};
    this.classList = { add() {}, remove() {} };
  }
  set innerHTML(value) { this._innerHTML = String(value); }
  get innerHTML() { return this._innerHTML; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatchEvent(type, event = {}) {
    const list = this.listeners.get(type) || [];
    list.forEach(fn => fn(event));
  }
  click() {
    if (typeof this.onclick === 'function') this.onclick();
    this.dispatchEvent('click', { target: this });
  }
  focus() {}
  blur() {}
  querySelectorAll() { return []; }
}

function boot(preloadedState) {
  const elements = {};
  const local = new Map();

  if (preloadedState) {
    local.set(STORAGE_KEY, JSON.stringify(preloadedState));
  }

  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = new Element(id);
      return elements[id];
    },
    querySelectorAll() { return []; },
    createElement(tag) { return new Element(tag); }
  };

  const context = {
    document,
    localStorage: {
      getItem(k) { return local.has(k) ? local.get(k) : null; },
      setItem(k, v) { local.set(k, String(v)); },
      removeItem(k) { local.delete(k); }
    },
    Blob: class {},
    URL: { createObjectURL() { return 'blob://x'; }, revokeObjectURL() {} },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    console,
    window: null
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.confirm = () => true;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(APP_JS, 'utf8'), context, { filename: APP_JS });

  return {
    context,
    getState() {
      return JSON.parse(local.get(STORAGE_KEY));
    }
  };
}

(function run() {
  const h = boot();
  const state = vm.runInContext('state', h.context);

  // 1) timeout/abort path should not fail immediately
  const pendingJob = {
    id: 'JOB-PENDING-1',
    status: 'sending',
    sentAt: new Date().toISOString(),
    bridgeJobId: 'BRIDGE-1',
    copies: 1
  };
  state.jobs.push(pendingJob);
  h.context.markJobPendingConfirmation(pendingJob, 'send_timeout_or_abort');
  assert.equal(pendingJob.status, 'sent', 'timeout/abort should move job to non-terminal sent status');
  assert.equal(pendingJob.pendingConfirmation.reasonCode, 'send_timeout_or_abort');

  // 2) PRINTING signal should promote pending/sent job to printing
  h.context.applyLiveStatus({ engineState: 'PRINTING', faults: [] }, { channel: 'test-printing' });
  assert.equal(pendingJob.status, 'printing', 'engine PRINTING should promote sent job to printing');

  // 3) IDLE after printing should mark completed
  h.context.applyLiveStatus({ engineState: 'IDLE', faults: [] }, { channel: 'test-idle' });
  assert.equal(pendingJob.status, 'done', 'engine IDLE after printing should complete job');

  // 4) grace timeout without printing should fail pending job
  const timedOutJob = {
    id: 'JOB-PENDING-2',
    status: 'sent',
    pendingConfirmation: {
      reasonCode: 'send_timeout_or_abort',
      startedAt: new Date(Date.now() - 120000).toISOString(),
      graceMs: 90000
    },
    sentAt: new Date(Date.now() - 120000).toISOString(),
    bridgeJobId: 'BRIDGE-2',
    copies: 1
  };
  state.jobs.push(timedOutJob);
  h.context.applyLiveStatus({ engineState: 'READY', faults: [] }, { channel: 'test-timeout' });
  assert.equal(timedOutJob.status, 'failed', 'pending confirmation should fail after grace timeout without print evidence');
  assert.equal(timedOutJob.failReason, 'pending_confirmation_timeout');

  console.log('PASS send-confirmation-lifecycle');
})();
