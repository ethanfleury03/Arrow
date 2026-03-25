#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FIXED_GENERATED_AT = '2026-03-13T00:00:00.000Z';

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const runbook = readJson('dist/CONTROL_RUNBOOK.json');
const scenarios = readJson('dist/SCENARIO_REPORT.json');

const drillSteps = runbook.scenarios.map(s => ({
  id: s.id,
  objective: s.objective,
  expectedResult: s.expectedResult,
  steps: s.steps
}));

const expectedFaultCodes = scenarios.outcomes
  .filter(o => o.outcome && o.outcome.faultCode)
  .map(o => ({ id: o.id, faultCode: o.outcome.faultCode }));

const card = {
  artifact: 'DRILL_CARD',
  generatedAt: FIXED_GENERATED_AT,
  mode: 'offline-deterministic',
  drillSteps,
  expectedFaultCodes,
  acceptance: {
    runbookScenarioCount: runbook.scenarios.length,
    scenarioMatrixCount: scenarios.scenarioCount,
    profile: `${scenarios.passCount} PASS / ${scenarios.failCount} FAIL (expected deterministic matrix)`
  }
};

const md = [
  '# Operator Drill Card',
  '',
  '- Generated: 2026-03-13T00:00:00.000Z',
  '- Mode: offline-deterministic',
  '',
  '## Drill Steps',
  ...drillSteps.flatMap(s => [
    `### ${s.id}`,
    `- Objective: ${s.objective}`,
    `- Expected: ${s.expectedResult}`,
    `- Steps: ${s.steps.join(' -> ')}`,
    ''
  ]),
  '## Expected Fault Codes from Matrix',
  ...expectedFaultCodes.map(f => `- ${f.id}: ${f.faultCode}`),
  '',
  '## Acceptance Profile',
  `- Runbook scenarios: ${card.acceptance.runbookScenarioCount}`,
  `- Scenario matrix: ${card.acceptance.scenarioMatrixCount}`,
  `- Profile: ${card.acceptance.profile}`,
  ''
].join('\n');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'DRILL_CARD.json'), JSON.stringify(card, null, 2) + '\n');
fs.writeFileSync(path.join(DIST, 'DRILL_CARD.md'), md + '\n');

console.log('PASS drill card generated');
