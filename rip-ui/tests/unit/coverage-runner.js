// c8 coverage runner for app.js tests
const c8 = require('c8');
const path = require('path');
const { spawn } = require('child_process');

const appJsPath = path.resolve(__dirname, '../src/app.js');

const runner = new c8({
  include: [appJsPath],
  exclude: ['**/node_modules/**', '**/tests/**', '**/coverage/**'],
  reporter: 'text',
  workDir: path.resolve(__dirname, '../coverage')
});

runner.run(['node', '--require', './tests/unit/jsdom.setup.js', 'tests/unit/app.test.js'])
  .then(result => {
    console.log(result.output);
    process.exit(result.code);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
