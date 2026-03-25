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
  addEventListener: noop,
  appendChild: noop,
  querySelector: () => el(),
  querySelectorAll: () => []
});

const context = {
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: noop,
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
