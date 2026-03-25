const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyCompletionGuard } = require('../scripts/completion-guard');

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

(function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-guard-'));

  const required = [
    'dist/RELEASE_MANIFEST.json',
    'dist/SUBMITTER_REPORT.json'
  ];

  writeFile(path.join(tmp, 'TODO.md'), '# TODO\n\n- [x] done\n');
  writeFile(path.join(tmp, 'dist/RELEASE_MANIFEST.json'), '{"ok":true}');
  writeFile(path.join(tmp, 'dist/SUBMITTER_REPORT.json'), '{"ok":true}');

  const pass = verifyCompletionGuard({ rootDir: tmp, requiredArtifacts: required });
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.missingArtifacts, []);
  assert.deepEqual(pass.uncheckedTodo, []);

  writeFile(path.join(tmp, 'TODO.md'), '# TODO\n\n- [ ] still open\n');
  fs.rmSync(path.join(tmp, 'dist/SUBMITTER_REPORT.json'), { force: true });

  const fail = verifyCompletionGuard({ rootDir: tmp, requiredArtifacts: required });
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.missingArtifacts, ['dist/SUBMITTER_REPORT.json']);
  assert.equal(fail.uncheckedTodo.length, 1);
  assert.equal(fail.uncheckedTodo[0].line, 3);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('completion-guard.test: PASS');
})();
