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

// Test: Verify getBasename helper function behavior
(function testBasenameExtraction() {
  const testCases = [
    { input: 'C:\\Users\\Operator\\Documents\\file.pdf', expected: 'file.pdf', desc: 'Windows path' },
    { input: '/home/operator/documents/file.pdf', expected: 'file.pdf', desc: 'Unix path' },
    { input: 'file.pdf', expected: 'file.pdf', desc: 'Filename only' },
    { input: 'C:\\file.pdf', expected: 'file.pdf', desc: 'Windows root path' },
    { input: '/file.pdf', expected: 'file.pdf', desc: 'Unix root path' },
    { input: '', expected: null, desc: 'Empty string' },
    { input: null, expected: null, desc: 'Null input' },
    { input: undefined, expected: null, desc: 'Undefined input' },
    { input: 'path/to/dir/', expected: 'dir', desc: 'Trailing slash returns directory name' },
    { input: '\\\\server\\share\\file.pdf', expected: 'file.pdf', desc: 'UNC Windows path' }
  ];

  // We need to access the getBasename function from the VM context
  const context = {
    document: { getElementById() { return new Element('x'); }, querySelectorAll() { return []; }, createElement() { return new Element('x'); } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
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

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(APP_JS, 'utf8'), context, { filename: APP_JS });

  // Access getBasename and getJobDisplayName from the context
  const getBasename = context.getBasename;
  const getJobDisplayName = context.getJobDisplayName;

  assert(typeof getBasename === 'function', 'getBasename should be defined');
  assert(typeof getJobDisplayName === 'function', 'getJobDisplayName should be defined');

  for (const tc of testCases) {
    const result = getBasename(tc.input);
    assert.strictEqual(result, tc.expected, `getBasename failed for ${tc.desc}: expected "${tc.expected}", got "${result}"`);
  }

  console.log('PASS: getBasename extraction tests');
})();

// Test: Verify getJobDisplayName priority logic
(function testJobDisplayNamePriority() {
  const context = {
    document: { getElementById() { return new Element('x'); }, querySelectorAll() { return []; }, createElement() { return new Element('x'); } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
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

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(APP_JS, 'utf8'), context, { filename: APP_JS });

  const getJobDisplayName = context.getJobDisplayName;

  // Test priority 1: job.name
  assert.strictEqual(getJobDisplayName({ name: 'custom_name.pdf' }), 'custom_name.pdf', 'Should use job.name');
  
  // Test priority 2: basename(inputPath)
  assert.strictEqual(getJobDisplayName({ inputPath: '/path/to/input_file.pdf' }), 'input_file.pdf', 'Should use basename of inputPath');
  assert.strictEqual(getJobDisplayName({ inputPath: 'C:\\path\\to\\input_file.pdf' }), 'input_file.pdf', 'Should use basename of Windows inputPath');
  
  // Test priority 3: basename(artifactPath)
  assert.strictEqual(getJobDisplayName({ artifactPath: '/path/to/artifact.pdf' }), 'artifact.pdf', 'Should use basename of artifactPath');
  
  // Test fallback
  assert.strictEqual(getJobDisplayName({}), '—', 'Should return fallback for empty job');
  assert.strictEqual(getJobDisplayName(null), '—', 'Should return fallback for null');
  assert.strictEqual(getJobDisplayName(undefined), '—', 'Should return fallback for undefined');
  
  // Test that name takes precedence over paths
  assert.strictEqual(
    getJobDisplayName({ name: 'my_name.pdf', inputPath: '/path/to/input.pdf' }), 
    'my_name.pdf', 
    'job.name should take precedence over inputPath'
  );

  console.log('PASS: getJobDisplayName priority tests');
})();

// Test: Verify jobs table renders with PDF name column (not queue position)
(function testJobsTableRendering() {
  const h = boot();

  const initialHtml = h.elements.jobTable.innerHTML;
  
  // Verify jobs are rendered
  assert(initialHtml.includes('JOB-0001'), 'queued tab should show active jobs by default');
  
  // Verify PDF names are shown (from INITIAL_STATE)
  assert(initialHtml.includes('label_sheet_A.pdf'), 'should display PDF name for JOB-0001');
  assert(initialHtml.includes('test_patch_v2.pdf'), 'should display PDF name for JOB-0002');
  
  // Verify queue position is NOT shown (no #1, #2, etc.)
  assert(!initialHtml.includes('#1'), 'should not show queue position #1');
  assert(!initialHtml.includes('#2'), 'should not show queue position #2');
  
  // Verify cell-pdf-name class is used
  assert(initialHtml.includes('cell-pdf-name'), 'should use cell-pdf-name class');
  
  // Verify no cell-position class (old column)
  assert(!initialHtml.includes('cell-position'), 'should not use old cell-position class');

  console.log('PASS: jobs table rendering tests');
})();

// Test: Verify past jobs show PDF names correctly
(function testPastJobsPdfName() {
  const h = boot();

  // Force bridge-unavailable auto dispatch path to produce a failed terminal job.
  h.elements.btnAutoSendToggle.click();

  h.elements.btnJobsTabPast.click();
  const pastHtml = h.elements.jobTable.innerHTML;
  
  // Verify past jobs are shown
  assert(pastHtml.includes('JOB-0001'), 'past tab should show terminal jobs');
  
  // Verify PDF names appear in past jobs too
  assert(pastHtml.includes('label_sheet_A.pdf') || pastHtml.includes('test_patch_v2.pdf'), 
    'past jobs should show PDF names');

  console.log('PASS: past jobs PDF name tests');
})();

// Test: Verify no full path leakage in table
(function testNoPathLeakage() {
  const h = boot();
  
  const html = h.elements.jobTable.innerHTML;
  
  // Verify full Windows paths are NOT shown
  assert(!html.includes('C:\\Users\\Operator\\Documents\\'), 
    'should not leak full Windows path in table');
  
  // Verify full Unix paths are NOT shown
  assert(!html.includes('/home/operator/documents/'), 
    'should not leak full Unix path in table');
  
  // Verify filenames only are shown
  assert(html.includes('label_sheet_A.pdf'), 'should show basename for Windows path job');
  assert(html.includes('test_patch_v2.pdf'), 'should show basename for Unix path job');

  console.log('PASS: no path leakage tests');
})();

// Original tests for tabs and filters
(function testOriginalFunctionality() {
  const h = boot();

  h.elements.btnAutoSendToggle.click();
  h.elements.btnJobsTabPast.click();
  
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

  console.log('PASS: original tabs/filters functionality');
})();

console.log('PASS jobs-tabs-ui');
