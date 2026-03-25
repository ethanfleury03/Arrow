const path = require('node:path');

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function pickString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}

function pickNumber(values, fallback) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function resolveArrowRoot(env = process.env) {
  const configured = String(env.ARROW_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '..');
}

function loadBridgeConfig(env = process.env) {
  const port = num(env.RIP_BRIDGE_PORT, 8787);
  const arrowRoot = resolveArrowRoot(env);

  // MEMJET_TARGET_* is the forced/locked target override and always wins when set.
  const targetHost = pickString(env.MEMJET_TARGET_HOST, env.MEMJET_HOST, '192.168.111.2');
  const targetCommandPort = pickNumber([env.MEMJET_TARGET_COMMAND_PORT, env.MEMJET_COMMAND_PORT], 13002);
  const targetEventPort = pickNumber([env.MEMJET_TARGET_EVENT_PORT, env.MEMJET_EVENT_PORT], 9231);
  const targetDataPort = pickNumber([env.MEMJET_TARGET_DATA_PORT, env.MEMJET_DATA_PORT], 13001);

  return {
    port,
    host: env.RIP_BRIDGE_HOST || '127.0.0.1',
    logLevel: env.RIP_BRIDGE_LOG_LEVEL || 'info',
    memjet: {
      mode: env.MEMJET_MODE || 'real',
      host: targetHost,
      commandPort: targetCommandPort,
      eventPort: targetEventPort,
      dataPort: targetDataPort,
      protocol: env.MEMJET_PROTOCOL || 'thrift-compact',
      transport: env.MEMJET_TRANSPORT || 'framed',
      connectTimeoutMs: num(env.MEMJET_CONNECT_TIMEOUT_MS, 700),
      allowDataSubmission: bool(env.MEMJET_ALLOW_DATA_SUBMISSION, false),
      defaultIps: num(env.MEMJET_DEFAULT_IPS, 15),
      enableRealCommands: bool(env.RIP_BRIDGE_ENABLE_REAL_COMMANDS, false),
      enableRealStartPrint: bool(env.RIP_BRIDGE_ENABLE_REAL_START_PRINT, false),
      dryRunRealSequence: bool(env.RIP_BRIDGE_REAL_DRY_RUN, true),
      clientFactoryPath: env.MEMJET_THRIFT_CLIENT_FACTORY || path.join(arrowRoot, 'bridge', 'real-client-factory.local.js')
    },
    bridgeBaseUrl: env.RIP_BRIDGE_BASE_URL || `http://127.0.0.1:${port}`,
    logDir: env.RIP_BRIDGE_LOG_DIR || path.join(arrowRoot, 'logs'),
    dataDir: env.RIP_BRIDGE_DATA_DIR || path.join(arrowRoot, 'bridge-data')
  };
}

module.exports = { loadBridgeConfig, resolveArrowRoot };
