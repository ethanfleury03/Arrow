#!/usr/bin/env node
/* deterministic smoke test for core app surface */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');

const noop = () => {};
const el = () => ({
  textContent: '',
  value: '',
  innerHTML: '',
  className: '',
  style: {},
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  children: [],
  addEventListener: noop,
  removeEventListener: noop,
  appendChild: noop,
  removeChild: noop,
  setAttribute: noop,
  getAttribute: () => null,
  querySelector: () => el(),
  querySelectorAll: () => []
});

const context = {
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: noop,
  setInterval: () => 999,
  clearInterval: noop,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  addEventListener: noop,
  removeEventListener: noop,
  devicePixelRatio: 1,
  confirm: () => true,
  prompt: () => '1',
  fetch: () => Promise.reject(new Error('no network in smoke')),
  Date,
  Math,
  JSON,
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  document: {
    addEventListener: (name, cb) => { if (name === 'DOMContentLoaded') cb(); },
    querySelector: () => el(),
    querySelectorAll: () => [],
    getElementById: () => el(),
    createElement: () => el(),
    body: el()
  },
  window: {},
  navigator: { userAgent: 'smoke-test' }
};
context.window = context;

vm.createContext(context);
vm.runInContext(appJs, context, { filename: 'src/app.js' });
console.log('SMOKE_OK: app script evaluated with deterministic fake DOM');
