const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PESCTL = path.join(ROOT, 'docs', 'pesctl');
const READY = path.join(ROOT, 'docs', 'pesctl-ready-to-copy.sh');

console.log('\nclean_light regression checks\n');

for (const file of [PESCTL, READY]) {
  const src = fs.readFileSync(file, 'utf8');
  assert.match(
    src,
    /client\.startServicing\(\[service_map\[level\]\]\)/,
    `${path.basename(file)} should pass a list arg to startServicing to avoid runtime script failures`
  );
}

console.log('PASS clean_light regression checks');
