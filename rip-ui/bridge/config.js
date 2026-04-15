const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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

/**
 * Load user network configuration from bridge-data/network.json
 * This allows users to configure printer connection without modifying package.json
 */
function loadNetworkConfig(arrowRoot) {
  const configPath = path.join(arrowRoot, 'bridge-data', 'network.json');
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    
    // Expand ~ in sshKeyPath to home directory
    if (config.settings?.sshKeyPath?.startsWith('~')) {
      config.settings.sshKeyPath = config.settings.sshKeyPath.replace('~', os.homedir());
    }
    
    return config.settings || {};
  } catch (err) {
    // File doesn't exist or is invalid - return empty config
    return {};
  }
}

function loadBridgeConfig(env = process.env) {
  const port = num(env.RIP_BRIDGE_PORT, 8787);
  const arrowRoot = resolveArrowRoot(env);
  
  // Load user network config (from network.json)
  const networkConfig = loadNetworkConfig(arrowRoot);

  const pes = loadPesDefaults(env);
  
  // Override with user network config if provided, otherwise use PES defaults or env vars
  const targetHost = networkConfig.printerIp || pes.host;
  const targetCommandPort = networkConfig.pesPort || pes.commandPort;
  const targetEventPort = networkConfig.pesPort ? networkConfig.pesPort + 1 : pes.eventPort;
  const targetDataPort = networkConfig.pesPort ? networkConfig.pesPort + 2 : pes.dataPort;

  return {
    port,
    host: env.RIP_BRIDGE_HOST || '127.0.0.1',
    logLevel: env.RIP_BRIDGE_LOG_LEVEL || 'info',
    network: {
      connectionMode: networkConfig.connectionMode || 'local-network',
      printerIp: targetHost,
      printerPort: networkConfig.printerPort || 22,
      sshUsername: networkConfig.sshUsername || 'root',
      sshKeyPath: networkConfig.sshKeyPath || path.join(os.homedir(), '.ssh', 'id_ed25519'),
      gatewayPort: networkConfig.gatewayPort || 8080,
      pesPort: networkConfig.pesPort || 9090,
      autoConnect: bool(networkConfig.autoConnect, false),
      connectionTimeout: num(networkConfig.connectionTimeout, 10000)
    },
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
      clientFactoryPath: env.MEMJET_THRIFT_CLIENT_FACTORY || path.join(arrowRoot, 'bridge', 'real-client-factory.local.js'),
      backend: env.MEMJET_REAL_BACKEND || 'direct'
    },
    bridgeBaseUrl: env.RIP_BRIDGE_BASE_URL || `http://127.0.0.1:${port}`,
    logDir: env.RIP_BRIDGE_LOG_DIR || path.join(arrowRoot, 'logs'),
    dataDir: env.RIP_BRIDGE_DATA_DIR || path.join(arrowRoot, 'bridge-data')
  };
}

module.exports = { loadBridgeConfig, resolveArrowRoot, loadNetworkConfig };
