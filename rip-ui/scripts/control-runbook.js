#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(outDir, { recursive: true });

const scenarios = [
  {
    id: 'nominal-print',
    objective: 'Happy-path print sequence with one queued job',
    steps: ['clear', 'initialise', 'prepare', 'start', 'finish', 'shutdown'],
    expectedResult: 'PASS',
    notes: 'prepare requires queued job at queue head; simulator seeds one deterministic job.'
  },
  {
    id: 'fault-no-queued-job',
    objective: 'Validate deterministic guardrail when no queued job exists',
    steps: ['clear', 'initialise', 'prepare'],
    expectedResult: 'FAIL',
    expectedError: 'prepare requires at least one queued job',
    notes: 'Mirrors known PES behavior when queue head is empty.'
  },
  {
    id: 'fault-then-recover',
    objective: 'Demonstrate deterministic recovery from prepare failure',
    steps: ['clear', 'initialise', 'prepare (fail)', 'requeue-job', 'prepare', 'start', 'finish'],
    expectedResult: 'RECOVERED',
    notes: 'Recovery path succeeds after deterministic requeue of single job.'
  }
];

const jsonReport = {
  artifact: 'CONTROL_RUNBOOK',
  protocol: 'TSocket + TFramedTransport + TCompactProtocol',
  readOnlyDiscoveryMode: true,
  scenarios
};

const md = [
  '# Control Sequence Runbook',
  '',
  'Deterministic, offline-first control-sequence reference for RIP UI Prototype.',
  '',
  `Protocol baseline: \`${jsonReport.protocol}\``,
  `Read-only discovery mode: \`${jsonReport.readOnlyDiscoveryMode}\``,
  '',
  '## Scenarios',
  ''
];

for (const scenario of scenarios) {
  md.push(`### ${scenario.id}`);
  md.push(`- Objective: ${scenario.objective}`);
  md.push(`- Steps: ${scenario.steps.join(' -> ')}`);
  md.push(`- Expected result: ${scenario.expectedResult}`);
  if (scenario.expectedError) md.push(`- Expected error: ${scenario.expectedError}`);
  md.push(`- Notes: ${scenario.notes}`);
  md.push('');
}

fs.writeFileSync(path.join(outDir, 'CONTROL_RUNBOOK.json'), JSON.stringify(jsonReport, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'CONTROL_RUNBOOK.md'), md.join('\n') + '\n');

console.log('Generated dist/CONTROL_RUNBOOK.json and dist/CONTROL_RUNBOOK.md');
