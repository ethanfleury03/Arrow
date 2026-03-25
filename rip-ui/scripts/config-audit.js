const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CONFIG_FILE = path.join(ROOT, 'config.template.json');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function check(condition, passMessage, failMessage) {
  return {
    pass: Boolean(condition),
    message: condition ? passMessage : failMessage
  };
}

function runChecks(config) {
  return [
    check(typeof config?.app?.name === 'string' && config.app.name.trim().length > 0,
      'app.name present',
      'app.name missing or empty'),
    check(config?.app?.readOnlyDiscovery === true,
      'app.readOnlyDiscovery is true',
      'app.readOnlyDiscovery must be true for offline-safe default'),
    check(typeof config?.rip?.protocol === 'string' && config.rip.protocol === 'thrift-compact-framed',
      'rip.protocol is thrift-compact-framed',
      'rip.protocol must be thrift-compact-framed'),
    check(typeof config?.rip?.host === 'string' && config.rip.host.trim().length > 0,
      'rip.host present',
      'rip.host missing or empty'),
    check(isPositiveInteger(config?.rip?.jobDataPort),
      'rip.jobDataPort is a positive integer',
      'rip.jobDataPort must be a positive integer'),
    check(isPositiveInteger(config?.rip?.commandPort),
      'rip.commandPort is a positive integer',
      'rip.commandPort must be a positive integer'),
    check(isPositiveInteger(config?.rip?.eventPort),
      'rip.eventPort is a positive integer',
      'rip.eventPort must be a positive integer'),
    check(isPositiveInteger(config?.defaults?.queuePollIntervalMs),
      'defaults.queuePollIntervalMs is a positive integer',
      'defaults.queuePollIntervalMs must be a positive integer'),
    check(isPositiveInteger(config?.defaults?.maxLogEntries),
      'defaults.maxLogEntries is a positive integer',
      'defaults.maxLogEntries must be a positive integer'),
    check(typeof config?.defaults?.operatorUsername === 'string' && config.defaults.operatorUsername.trim().length > 0,
      'defaults.operatorUsername present',
      'defaults.operatorUsername missing or empty'),
    check(typeof config?.defaults?.operatorBadgeId === 'string' && config.defaults.operatorBadgeId.trim().length > 0,
      'defaults.operatorBadgeId present',
      'defaults.operatorBadgeId missing or empty'),
    check(typeof config?.defaults?.operatorIdentitySecret === 'string' && config.defaults.operatorIdentitySecret.trim().length > 0,
      'defaults.operatorIdentitySecret present',
      'defaults.operatorIdentitySecret missing or empty')
  ];
}

function toMarkdown(report) {
  const lines = [];
  lines.push('# CONFIG AUDIT');
  lines.push('');
  lines.push(`- file: ${report.file}`);
  lines.push(`- overall: ${report.allPass ? 'PASS' : 'FAIL'}`);
  lines.push(`- checks: ${report.passCount}/${report.checkCount}`);
  lines.push('');
  lines.push('## Results');
  for (const item of report.results) {
    lines.push(`- ${item.pass ? '✅' : '❌'} ${item.message}`);
  }
  return lines.join('\n');
}

function main() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = JSON.parse(raw);
  const results = runChecks(config);
  const passCount = results.filter(item => item.pass).length;

  const report = {
    file: path.relative(ROOT, CONFIG_FILE),
    allPass: passCount === results.length,
    passCount,
    checkCount: results.length,
    results
  };

  const jsonPath = path.join(DIST, 'CONFIG_AUDIT.json');
  const mdPath = path.join(DIST, 'CONFIG_AUDIT.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(report));

  console.log(`PASS config audit -> ${path.relative(ROOT, jsonPath)} + ${path.relative(ROOT, mdPath)}`);
}

main();
