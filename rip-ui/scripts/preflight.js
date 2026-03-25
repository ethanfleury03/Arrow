#!/usr/bin/env node
/* deterministic offline preflight artifact generator for hookup readiness */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const checklistPath = path.join(root, 'HOOKUP_CHECKLIST.md');
const configPath = path.join(root, 'config.template.json');
const outputJsonPath = path.join(distDir, 'PREFLIGHT_REPORT.json');
const outputMdPath = path.join(distDir, 'PREFLIGHT_SUMMARY.md');

const expectedSequence = ['clear', 'initialise', 'prepare', 'start', 'finish', 'shutdown'];
const requiredConfigPaths = [
  'app.name',
  'app.mode',
  'app.readOnlyDiscovery',
  'rip.host',
  'rip.commandPort',
  'rip.eventPort',
  'rip.protocol',
  'defaults.intendedSpeedIps'
];

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseChecklist(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ['))
    .map((line) => line.replace(/^- \[[ x]\]\s*/, ''));
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

function evaluate(report) {
  const failed = report.checks.filter((c) => c.status !== 'PASS');
  return {
    overall: failed.length === 0 ? 'PASS' : 'FAIL',
    passedChecks: report.checks.length - failed.length,
    totalChecks: report.checks.length,
    failedChecks: failed.map((c) => c.id)
  };
}

const checklistText = readText(checklistPath);
const configText = readText(configPath);
const checklistItems = parseChecklist(checklistText);
const configParsed = safeJsonParse(configText);

const checks = [];

checks.push({
  id: 'checklist-minimum-items',
  status: checklistItems.length >= 7 ? 'PASS' : 'FAIL',
  detail: `Found ${checklistItems.length} checklist items (expected >= 7)`
});

const sequenceText = checklistItems.join(' ').toLowerCase();
checks.push({
  id: 'control-sequence-documented',
  status: expectedSequence.every((step) => sequenceText.includes(step)) ? 'PASS' : 'FAIL',
  detail: `Expected sequence: ${expectedSequence.join(' -> ')}`
});

checks.push({
  id: 'config-json-parseable',
  status: configParsed.ok ? 'PASS' : 'FAIL',
  detail: configParsed.ok ? 'config.template.json parsed successfully' : `JSON parse error: ${configParsed.error}`
});

if (configParsed.ok) {
  const cfg = configParsed.value;
  const getPathValue = (obj, dotted) => dotted.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
  const missingPaths = requiredConfigPaths.filter((configPath) => typeof getPathValue(cfg, configPath) === 'undefined');

  checks.push({
    id: 'config-required-keys',
    status: missingPaths.length === 0 ? 'PASS' : 'FAIL',
    detail: missingPaths.length ? `Missing paths: ${missingPaths.join(', ')}` : 'All required config paths are present'
  });

  checks.push({
    id: 'protocol-thrift-compact-framed',
    status: getPathValue(cfg, 'rip.protocol') === 'thrift-compact-framed' ? 'PASS' : 'FAIL',
    detail: `rip.protocol=${String(getPathValue(cfg, 'rip.protocol'))}`
  });

  checks.push({
    id: 'discovery-mode-read-only',
    status: getPathValue(cfg, 'app.readOnlyDiscovery') === true ? 'PASS' : 'FAIL',
    detail: `app.readOnlyDiscovery=${String(getPathValue(cfg, 'app.readOnlyDiscovery'))}`
  });
}

const report = {
  milestone: 'M7',
  title: 'Offline Hookup Readiness Preflight',
  generatedAt: '1970-01-01T00:00:00.000Z',
  deterministic: true,
  inputs: {
    checklist: {
      path: 'HOOKUP_CHECKLIST.md',
      sha256: sha256(checklistText),
      items: checklistItems
    },
    configTemplate: {
      path: 'config.template.json',
      sha256: sha256(configText)
    }
  },
  checks
};

report.summary = evaluate(report);

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const summaryMd = [
  '# Preflight Summary (M7)',
  '',
  `- Overall: **${report.summary.overall}**`,
  `- Passed: ${report.summary.passedChecks}/${report.summary.totalChecks}`,
  report.summary.failedChecks.length
    ? `- Failed checks: ${report.summary.failedChecks.join(', ')}`
    : '- Failed checks: none',
  '- Artifact: `dist/PREFLIGHT_REPORT.json`',
  '- Deterministic timestamp: `1970-01-01T00:00:00.000Z`'
].join('\n');

fs.writeFileSync(outputMdPath, `${summaryMd}\n`, 'utf8');

console.log(`PREFLIGHT_OK: wrote ${path.relative(root, outputJsonPath)} and ${path.relative(root, outputMdPath)}`);
