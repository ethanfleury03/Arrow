/**
 * jsdom test harness for app.js
 *
 * Loads app.js via window.eval() inside jsdom, which runs it in jsdom's
 * V8 context with full window/document/etc. support.
 *
 * Exposes jsdom window globals to Node's global scope so test files
 * can destructure functions directly.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Read app.js once
const appJsPath = path.resolve(__dirname, '../../src/app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');

// ── Create jsdom ─────────────────────────────────────────────────────────────
const dom = new JSDOM(
  `<!DOCTYPE html><html><head></head><body></body></html>`,
  {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    storageBlocking: true,
  }
);

const { window } = dom;
const { document } = window;

// ── localStorage (Node 24: must use Object.defineProperty) ──────────────────
const _storage = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: k => _storage[k] ?? null,
    setItem: (k, v) => { _storage[k] = String(v); },
    removeItem: k => { delete _storage[k]; },
    clear: () => { Object.keys(_storage).forEach(k => delete _storage[k]); },
    get length() { return Object.keys(_storage).length; },
    key: i => Object.keys(_storage)[i] || null,
  },
  writable: true,
  configurable: true,
});

// ── Other browser globals ────────────────────────────────────────────────────
window.fetch = () => Promise.reject(new Error('Network blocked'));
Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true });

window.XMLHttpRequest = class {
  constructor() {}
  open() {} send() { this.onload && this.onload(); }
  setRequestHeader() {} abort() {}
  get status() { return 200; }
  get responseText() { return '{}'; }
  get response() { return '{}'; }
  get readyState() { return 4; }
};

let _clock = Date.now();
const _timers = [], _intervals = [];
window._advanceClock = ms => { _clock += ms; };
window.setTimeout = (h, d = 0) => { _timers.push({ when: _clock + d, handler: h }); return _timers.length; };
window.clearTimeout = () => { _timers.length = 0; };
window.setInterval = (h, d) => { _intervals.push({ id: _intervals.length, handler: h, delay: d, last: _clock }); return _intervals.length - 1; };
window.clearInterval = id => { _intervals.splice(id, 1); };
window.matchMedia = () => ({ matches: false, media: '', onchange: null, addListener: () => {}, removeListener: () => {} });
window.scrollTo = () => {};

// ── Canvas stub ──────────────────────────────────────────────────────────────
function makeCtx() {
  return {
    fillRect: () => {}, clearRect: () => {},
    getImageData: () => ({ data: [] }), putImageData: () => {},
    createImageData: () => [], setTransform: () => {},
    drawImage: () => {}, save: () => {}, restore: () => {},
    scale: () => {}, rotate: () => {}, translate: () => {},
    transform: () => {}, beginPath: () => {}, closePath: () => {},
    stroke: () => {}, fill: () => {}, strokeRect: () => {},
    arc: () => {}, measureText: () => ({ width: 0 }),
    addHitRegion: () => {}, isPointInPath: () => false, isPointInStroke: () => false,
    clip: () => {}, rect: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, fillText: () => {}, strokeText: () => {},
    setLineDash: () => {}, getLineDash: () => [], arcTo: () => {},
    createLinearGradient: () => ({}), createRadialGradient: () => ({}),
    lineDashOffset: 0,
    get lineWidth() { return 1; }, set lineWidth(v) {},
    get strokeStyle() { return ''; }, set strokeStyle(v) {},
    get fillStyle() { return ''; }, set fillStyle(v) {},
    get font() { return ''; }, set font(v) {},
    get textAlign() { return 'start'; }, set textAlign(v) {},
    get textBaseline() { return 'alphabetic'; }, set textBaseline(v) {},
    get shadowColor() { return ''; }, set shadowColor(v) {},
    get shadowBlur() { return 0; }, set shadowBlur(v) {},
    get shadowOffsetX() { return 0; }, set shadowOffsetX(v) {},
    get shadowOffsetY() { return 0; }, set shadowOffsetY(v) {},
    get globalAlpha() { return 1; }, set globalAlpha(v) {},
    get globalCompositeOperation() { return 'source-over'; }, set globalCompositeOperation(v) {},
    get imageSmoothingEnabled() { return true; }, set imageSmoothingEnabled(v) {},
    get imageSmoothingQuality() { return 'high'; }, set imageSmoothingQuality(v) {},
  };
}
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this._ctx) this._ctx = makeCtx();
  return this._ctx;
};
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 };
};

// ── DOM element factory ─────────────────────────────────────────────────────
function mkEl(id, tag = 'div') {
  const el = document.createElement(tag);
  el.id = id;
  Object.defineProperties(el, {
    disabled: { value: false, writable: true },
    checked: { value: false, writable: true },
    value: { value: '', writable: true, configurable: true },
    textContent: { value: '', writable: true },
    innerHTML: { value: '', writable: true, configurable: true },
    clientWidth: { value: 800, writable: true },
    clientHeight: { value: 600, writable: true },
    offsetWidth: { value: 800, writable: true },
    offsetHeight: { value: 600, writable: true },
    selectionStart: { value: 0, writable: true },
    selectionEnd: { value: 0, writable: true },
  });
  el.className = '';
  el.style = {};
  el.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} };
  el.addEventListener = el.removeEventListener = () => {};
  el.querySelectorAll = () => ({ forEach: () => {} });
  el.querySelector = () => null;
  el.getContext = () => null;
  el.appendChild = el.insertBefore = el.removeChild = () => {};
  el.setAttribute = el.getAttribute = () => null;
  el.focus = el.blur = el.scrollTo = () => {};
  document.body.appendChild(el);
  return el;
}

function mkInput(id, value = '') {
  const el = document.createElement('input');
  el.id = id;
  el.className = '';
  el.style = {};
  el.classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} };
  el.addEventListener = el.removeEventListener = () => {};
  el.querySelectorAll = () => ({ forEach: () => {} });
  el.querySelector = () => null;
  el.getContext = () => null;
  el.appendChild = el.insertBefore = el.removeChild = () => {};
  el.setAttribute = el.getAttribute = () => null;
  el.focus = el.blur = el.scrollTo = () => {};
  Object.defineProperties(el, {
    type: { value: 'number', writable: true, configurable: true },
    value: { value: String(value), writable: true, configurable: true },
    min: { value: '', writable: true },
    max: { value: '', writable: true },
    step: { value: '', writable: true },
    files: { value: { length: 0, item: () => null }, writable: true },
    disabled: { value: false, writable: true },
    checked: { value: false, writable: true },
    textContent: { value: '', writable: true },
    innerHTML: { value: '', writable: true },
    clientWidth: { value: 800, writable: true },
    clientHeight: { value: 600, writable: true },
    offsetWidth: { value: 800, writable: true },
    offsetHeight: { value: 600, writable: true },
    selectionStart: { value: 0, writable: true },
    selectionEnd: { value: 0, writable: true },
  });
  document.body.appendChild(el);
  return el;
}

// Populate the DOM
mkEl('layoutCanvas', 'canvas');
mkEl('layoutRulerCanvas', 'canvas');
mkEl('chkBoardMode', 'input');
mkEl('boardToolbar', 'div');
mkInput('boardWidthInches', '8.5');
mkInput('boardHeightInches', '11');
mkEl('btnAddPdfToBoard', 'button');
mkEl('boardPdfList', 'div');
mkEl('tab-jobs'); mkEl('tab-design'); mkEl('tab-config'); mkEl('tab-logs');
mkEl('tab-arrangement'); mkEl('tab-placement'); mkEl('tab-queue');
mkEl('tab-objects'); mkEl('tab-design-3d');
mkEl('right-tab-preview'); mkEl('right-tab-live'); mkEl('right-tab-settings');
mkInput('host'); mkInput('commandPort'); mkInput('statusPort'); mkInput('sessionId');
mkEl('layoutMode', 'input'); mkEl('flipH', 'input'); mkEl('flipV', 'input');
mkEl('reversePrint', 'input'); mkEl('mirrorMode', 'input');
mkEl('autoSend', 'input'); mkEl('discoveryMode', 'input');
mkEl('copyIntervalIncludesSize', 'input');
mkInput('auditRetentionMax'); mkEl('auditFilterType', 'input');
mkInput('gapHorizontal'); mkInput('gapVertical');
mkInput('copyHorizontalCount'); mkInput('copyVerticalCount');
mkInput('copyHorizontalSpacing'); mkInput('copyVerticalSpacing');
mkInput('copiesInput');
mkEl('layoutPresetSelect'); mkEl('orientationSelect');
mkEl('artWidthMm'); mkEl('artHeightMm');
mkEl('btnOpenSendJobModal'); mkEl('btnConfirmSendJob');
mkEl('queueCount'); mkEl('pastCount');
mkEl('layout-job-submission', 'div');
const ph = mkEl('panel-preview-header', 'div');
ph.appendChild(Object.assign(document.createElement('h2'), { textContent: '' }));
mkEl('jobTable', 'table');
mkEl('pastJobsTable', 'table');

// ── pdfjsLib stub ───────────────────────────────────────────────────────────
window.pdfjsLib = {
  getDocument: () => ({
    promise: Promise.resolve({
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 612, height: 792 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: '' },
};

window.FileReader = class {
  constructor() { this.onload = null; this.result = null; }
  readAsArrayBuffer() { this.onload && this.onload({ target: { result: new ArrayBuffer(0) } }); }
  readAsDataURL() { this.onload && this.onload({ target: { result: 'data:,,' } }); }
};
window.DataTransfer = class {
  constructor() { this.files = { length: 0, item: () => null }; }
};

// ── Suppress boot console noise ──────────────────────────────────────────────
const _realLog = console.log;
console.log = (...args) => {
  const msg = String(args[0] || '');
  if (!msg.includes('boot complete') && !msg.includes('Status streaming') &&
      !msg.includes('resumed from') && !msg.includes('Prototype')) {
    _realLog.apply(console, args);
  }
};
console.warn = () => {};
console.info = () => {};

// ── Intercept auto-boot functions before loading app.js ────────────────────
['bind', 'render', 'log', 'refreshQueueDepth', 'updateSendAndCopyButtons',
 'startStatusPolling', 'hydrateRuntimeConfig', 'hydratePersistedJobs'].forEach(k => {
  window[k] = () => {};
});

// ── Load app.js via window.eval() ─────────────────────────────────────────
// window.eval() runs in jsdom's V8 context, making all top-level
// function declarations become window properties (just like a browser <script>).
window.eval(appJsSource);

// Restore console
console.log = _realLog;

// ── Expose window globals to Node global scope ──────────────────────────────
for (const key of Object.keys(window)) {
  try { if (!(key in global)) global[key] = window[key]; } catch (_) { /* skip */ }
}

module.exports = { window, document, dom };
