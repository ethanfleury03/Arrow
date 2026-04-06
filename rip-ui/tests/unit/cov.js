process.chdir('/Users/sasha/Arrow/rip-ui');
const c8 = require('./node_modules/c8');

const runner = new c8({
  include: ['/Users/sasha/Arrow/rip-ui/src/app.js'],
  exclude: ['**/node_modules/**', '**/tests/**'],
  reporter: ['text', 'json'],
  workDir: '/Users/sasha/Arrow/rip-ui/coverage'
});

runner.run().then(async (result) => {
  process.stdout.write(result.output);
  process.exit(result.code || 0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
