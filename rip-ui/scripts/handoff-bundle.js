#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const FIXED_GENERATED_AT = '2026-03-13T00:00:00.000Z';

function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const preflight = readJson('dist/PREFLIGHT_REPORT.json');
const scenarios = readJson('dist/SCENARIO_REPORT.json');
const releaseManifest = readJson('dist/RELEASE_MANIFEST.json');
const controlRunbook = readJson('dist/CONTROL_RUNBOOK.json');

const gates = {
  preflightPass: preflight.summary?.overall === 'PASS',
  scenarioPass:
    Number.isInteger(scenarios.scenarioCount) &&
    scenarios.scenarioCount >= 3 &&
    Array.isArray(scenarios.outcomes) &&
    scenarios.outcomes.length === scenarios.scenarioCount,
  manifestPass: Boolean(releaseManifest.allPresent),
  runbookCoveragePass: Array.isArray(controlRunbook.scenarios) && controlRunbook.scenarios.length >= 3
};

const allPass = Object.values(gates).every(Boolean);

const handoff = {
  artifact: 'HANDOFF_BUNDLE',
  generatedAt: FIXED_GENERATED_AT,
  mode: 'offline-deterministic',
  protocol: controlRunbook.protocol,
  readOnlyDiscoveryMode: controlRunbook.readOnlyDiscoveryMode,
  gates,
  allPass,
  summary: {
    preflightChecklistItems: preflight.summary?.checklistItems ?? null,
    scenariosTotal: scenarios.scenarioCount,
    scenariosPass: scenarios.passCount,
    scenariosFail: scenarios.failCount,
    manifestFiles: Array.isArray(releaseManifest.entries) ? releaseManifest.entries.length : null,
    runbookScenarios: controlRunbook.scenarios.length
  },
  references: {
    preflight: 'dist/PREFLIGHT_REPORT.json',
    scenarios: 'dist/SCENARIO_REPORT.json',
    releaseManifest: 'dist/RELEASE_MANIFEST.json',
    controlRunbook: 'dist/CONTROL_RUNBOOK.json'
  }
};

const md = [
  '# Hookup Handoff Bundle',
  '',
  '- Generated: 2026-03-13T00:00:00.000Z',
  '- Mode: offline-deterministic',
  `- Protocol: ${handoff.protocol}`,
  `- Read-only discovery mode: ${handoff.readOnlyDiscoveryMode}`,
  '',
  '## Gate Results',
  `- preflightPass: ${gates.preflightPass ? 'PASS' : 'FAIL'}`,
  `- scenarioPass: ${gates.scenarioPass ? 'PASS' : 'FAIL'}`,
  `- manifestPass: ${gates.manifestPass ? 'PASS' : 'FAIL'}`,
  `- runbookCoveragePass: ${gates.runbookCoveragePass ? 'PASS' : 'FAIL'}`,
  `- overall: ${allPass ? 'PASS' : 'FAIL'}`,
  '',
  '## Summary',
  `- Preflight checklist items: ${handoff.summary.preflightChecklistItems}`,
  `- Scenario outcomes: ${handoff.summary.scenariosPass}/${handoff.summary.scenariosTotal} PASS (${handoff.summary.scenariosFail} FAIL)`,
  `- Release manifest files: ${handoff.summary.manifestFiles}`,
  `- Runbook scenarios: ${handoff.summary.runbookScenarios}`,
  ''
].join('\n');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'HANDOFF_BUNDLE.json'), JSON.stringify(handoff, null, 2) + '\n');
fs.writeFileSync(path.join(DIST, 'HANDOFF_BUNDLE.md'), md + '\n');

if (!allPass) {
  console.error('FAIL handoff bundle generated with failing gates');
  process.exit(1);
}

console.log('PASS handoff bundle generated');
