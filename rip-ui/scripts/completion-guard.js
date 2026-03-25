#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REQUIRED_ARTIFACTS = [
  'dist/RELEASE_MANIFEST.json',
  'dist/RELEASE_MANIFEST.md',
  'dist/SUBMITTER_REPORT.json',
  'dist/SUBMITTER_REPORT.md',
  'dist/HANDOFF_BUNDLE.json',
  'dist/HANDOFF_BUNDLE.md',
  'dist/HOOKUP_REPORT.json',
  'dist/HOOKUP_REPORT.md'
];

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function findUncheckedTodoLines(todoText) {
  const unchecked = [];
  const lines = todoText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*-\s*\[ \]/.test(lines[i])) {
      unchecked.push({ line: i + 1, text: lines[i] });
    }
  }
  return unchecked;
}

function verifyCompletionGuard({ rootDir, requiredArtifacts = DEFAULT_REQUIRED_ARTIFACTS, todoPath = 'TODO.md' } = {}) {
  const resolvedRoot = rootDir ? path.resolve(rootDir) : path.resolve(__dirname, '..');
  const todoAbsolutePath = path.resolve(resolvedRoot, todoPath);

  const missingArtifacts = requiredArtifacts
    .map(rel => ({ rel, abs: path.resolve(resolvedRoot, rel) }))
    .filter(entry => !fileExists(entry.abs))
    .map(entry => entry.rel);

  let uncheckedTodo = [];
  let todoReadable = true;

  if (!fileExists(todoAbsolutePath)) {
    todoReadable = false;
  } else {
    const todoText = fs.readFileSync(todoAbsolutePath, 'utf8');
    uncheckedTodo = findUncheckedTodoLines(todoText);
  }

  const ok = todoReadable && missingArtifacts.length === 0 && uncheckedTodo.length === 0;

  return {
    ok,
    checkedAt: new Date().toISOString(),
    rootDir: resolvedRoot,
    todoPath,
    todoReadable,
    missingArtifacts,
    uncheckedTodo,
    requiredArtifacts
  };
}

if (require.main === module) {
  const report = verifyCompletionGuard();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_REQUIRED_ARTIFACTS,
  findUncheckedTodoLines,
  verifyCompletionGuard
};
