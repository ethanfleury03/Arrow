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

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

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
  const intervals = [];

  if (preloadedState) {
    local.set(STORAGE_KEY, JSON.stringify(preloadedState));
  }

  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = new Element(id);
      return elements[id];
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return new Element(tag);
    }
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
    setInterval(fn) { intervals.push(fn); return intervals.length; },
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
    elements,
    getState() {
      return JSON.parse(local.get(STORAGE_KEY));
    }
  };
}

(function run() {
  const h = boot();

  const initialHtml = h.elements.jobTable.innerHTML;
  assert(initialHtml.includes('JOB-0001'), 'queued tab should show active jobs by default');

  // Drive at least one job to terminal state via deterministic simulation.
  h.elements.btnRunSimulation.click();

  h.elements.btnJobsTabPast.click();
  const pastHtml = h.elements.jobTable.innerHTML;
  assert(pastHtml.includes('JOB-0001'), 'past tab should show terminal jobs after lifecycle completion');

  h.elements.btnJobsTabQueued.click();
  const queuedHtml = h.elements.jobTable.innerHTML;
  assert(!queuedHtml.includes('JOB-0001'), 'queued tab should hide terminal jobs');

  const persisted = h.getState();
  assert.equal(persisted.ui.jobsTableTab, 'queued', 'selected jobs tab should persist to local state');

  console.log('PASS jobs-tabs-ui');
})();
