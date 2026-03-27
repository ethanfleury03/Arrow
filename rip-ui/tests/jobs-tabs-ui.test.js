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

  // Force bridge-unavailable auto dispatch path to produce a failed terminal job.
  h.elements.btnAutoSendToggle.click();

  h.elements.btnJobsTabPast.click();
  const pastHtml = h.elements.jobTable.innerHTML;
  assert(pastHtml.includes('JOB-0001'), 'past tab should show terminal jobs');

  h.elements.pastJobsFilters.dispatchEvent('click', {
    target: {
      closest(selector) {
        if (selector === 'button[data-past-filter]') return { dataset: { pastFilter: 'failed' } };
        return null;
      }
    }
  });

  const filteredHtml = h.elements.jobTable.innerHTML;
  assert(filteredHtml.includes('JOB-0001'), 'failed filter should keep failed jobs visible');

  h.elements.jobTable.dispatchEvent('click', {
    preventDefault() {},
    stopPropagation() {},
    target: {
      closest(selector) {
        if (selector === 'button[data-action="retry-job"][data-job-id]') return { dataset: { jobId: 'JOB-0001' } };
        return null;
      }
    }
  });

  const persisted = h.getState();
  assert(persisted.jobs.some(job => job.id === 'JOB-0001' && job.status === 'failed'), 'original failed job should remain in history');
  assert.equal(persisted.ui.jobsTableTab, 'past', 'selected jobs tab should persist to local state');
  assert.equal(persisted.ui.pastJobsFilter, 'failed', 'selected past jobs filter should persist');

  console.log('PASS jobs-tabs-ui');
})();
