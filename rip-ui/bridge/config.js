const path = require('node:path');
const { loadPesDefaults } = require('./pes-defaults');

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveArrowRoot(env = process.env) {
  const configured = String(env.ARROW_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '..');
}

function loadBridgeConfig(env = process.env) {
  const port = num(env.RIP_BRIDGE_PORT, 8787);
  const arrowRoot = resolveArrowRoot(env);

  const pes = loadPesDefaults(env);
  const targetHost = pes.host;
  const targetCommandPort = pes.commandPort;
  const targetEventPort = pes.eventPort;
  const targetDataPort = pes.dataPort;

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
      allowDataSubmission: bool(env.MEMJET_ALLOW_DATA_SUBMISSION, true),
      defaultIps: num(env.MEMJET_DEFAULT_IPS, 15),
      enableRealCommands: bool(env.RIP_BRIDGE_ENABLE_REAL_COMMANDS, true),
      enableRealStartPrint: bool(env.RIP_BRIDGE_ENABLE_REAL_START_PRINT, true),
      dryRunRealSequence: bool(env.RIP_BRIDGE_REAL_DRY_RUN, false),
      clientFactoryPath: env.MEMJET_THRIFT_CLIENT_FACTORY || path.join(arrowRoot, 'bridge', 'real-client-factory.local.js')
    },
    bridgeBaseUrl: env.RIP_BRIDGE_BASE_URL || `http://127.0.0.1:${port}`,
    logDir: env.RIP_BRIDGE_LOG_DIR || path.join(arrowRoot, 'logs'),
    dataDir: env.RIP_BRIDGE_DATA_DIR || path.join(arrowRoot, 'bridge-data')
  };
}

module.exports = { loadBridgeConfig, resolveArrowRoot };
