const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_PES_HOST, DEFAULT_COMMAND_PORT, DEFAULT_EVENT_PORT, DEFAULT_DATA_PORT
} = require('../bridge/pes-defaults');

const DEFAULT_PROFILE = 'kareela-lab';

const OPERATOR_PROFILES = {
  'kareela-lab': {
    backendMode: 'bridge-http',
    host: DEFAULT_PES_HOST,
    commandPort: DEFAULT_COMMAND_PORT,
    eventPort: DEFAULT_EVENT_PORT,
    dataPort: DEFAULT_DATA_PORT,
    bridgeHost: '127.0.0.1',
    bridgePort: 8787,
    adapterHost: '127.0.0.1',
    adapterPort: 8081,
    intendedSpeedIps: 120,
    pollIntervalMs: 1000
  }
};

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseJsonFile(filePath) {
  if (!filePath) return {};
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return {};

  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return {};
  }
}

function normalizeConfig(raw = {}) {
  return {
    backendMode: String(raw.backendMode || 'bridge-http').trim(),
    host: String(raw.host || '127.0.0.1').trim(),
    commandPort: clampInt(raw.commandPort, DEFAULT_COMMAND_PORT, 1, 65535),
    eventPort: clampInt(raw.eventPort, DEFAULT_EVENT_PORT, 1, 65535),
    dataPort: clampInt(raw.dataPort, DEFAULT_DATA_PORT, 1, 65535),
    bridgeHost: String(raw.bridgeHost || '127.0.0.1').trim(),
    bridgePort: clampInt(raw.bridgePort, 8787, 1, 65535),
    adapterHost: String(raw.adapterHost || raw.bridgeHost || '127.0.0.1').trim(),
    adapterPort: clampInt(raw.adapterPort, 8081, 1, 65535),
    intendedSpeedIps: clampInt(raw.intendedSpeedIps, 120, 10, 2000),
    pollIntervalMs: clampInt(raw.pollIntervalMs, 1000, 200, 10000),
    operatorUsername: String(raw.operatorUsername || 'unknown-operator').trim() || 'unknown-operator',
    operatorBadgeId: String(raw.operatorBadgeId || 'unassigned').trim() || 'unassigned',
    operatorIdentitySecret: String(raw.operatorIdentitySecret || '').trim()
  };
}

function loadRuntimeConfig({ env = process.env } = {}) {
  const profileName = String(env.RIP_OPERATOR_PROFILE || DEFAULT_PROFILE).trim();
  const fileConfig = parseJsonFile(env.RIP_UI_CONFIG_FILE);

  const profileDefaults = OPERATOR_PROFILES[profileName] || OPERATOR_PROFILES[DEFAULT_PROFILE];
  const fileProfile = fileConfig.profiles?.[profileName] || {};
  const resolvedProfileName = OPERATOR_PROFILES[profileName] ? profileName : DEFAULT_PROFILE;
  const isDefaultProfile = resolvedProfileName === DEFAULT_PROFILE;
  const resolvedBackendMode = env.RIP_BACKEND_MODE
    || fileProfile.backendMode
    || (!isDefaultProfile ? fileConfig.backendMode : null)
    || profileDefaults.backendMode
    || 'bridge-http';

  const merged = normalizeConfig({
    ...profileDefaults,
    ...(fileConfig.defaults || {}),
    ...fileProfile,
    backendMode: resolvedBackendMode,
    host: env.RIP_HOST || fileConfig.host || fileProfile.host || profileDefaults.host,
    commandPort: env.RIP_COMMAND_PORT || fileConfig.commandPort || fileProfile.commandPort || profileDefaults.commandPort,
    eventPort: env.RIP_EVENT_PORT || fileConfig.eventPort || fileProfile.eventPort || profileDefaults.eventPort,
    dataPort: env.RIP_DATA_PORT || fileConfig.dataPort || fileProfile.dataPort || profileDefaults.dataPort,
    bridgeHost:
      env.RIP_BRIDGE_HOST ||
      fileConfig.bridgeHost ||
      fileProfile.bridgeHost ||
      fileConfig.defaults?.bridgeHost ||
      profileDefaults.bridgeHost,
    bridgePort:
      env.RIP_BRIDGE_PORT ||
      fileConfig.bridgePort ||
      fileProfile.bridgePort ||
      fileConfig.defaults?.bridgePort ||
      profileDefaults.bridgePort,
    adapterHost:
      env.RIP_ADAPTER_HOST ||
      fileConfig.adapterHost ||
      fileProfile.adapterHost ||
      fileConfig.defaults?.adapterHost ||
      profileDefaults.adapterHost ||
      fileConfig.bridgeHost ||
      fileProfile.bridgeHost ||
      fileConfig.defaults?.bridgeHost ||
      profileDefaults.bridgeHost,
    adapterPort:
      env.RIP_ADAPTER_PORT ||
      fileConfig.adapterPort ||
      fileProfile.adapterPort ||
      fileConfig.defaults?.adapterPort ||
      profileDefaults.adapterPort ||
      8081,
    intendedSpeedIps:
      env.RIP_INTENDED_SPEED_IPS ||
      fileConfig.intendedSpeedIps ||
      fileProfile.intendedSpeedIps ||
      fileConfig.defaults?.intendedSpeedIps ||
      profileDefaults.intendedSpeedIps,
    pollIntervalMs:
      env.RIP_POLL_INTERVAL_MS ||
      fileConfig.pollIntervalMs ||
      fileProfile.pollIntervalMs ||
      fileConfig.defaults?.pollIntervalMs ||
      profileDefaults.pollIntervalMs,
    operatorUsername:
      env.RIP_OPERATOR_USERNAME ||
      fileConfig.operatorUsername ||
      fileProfile.operatorUsername ||
      fileConfig.defaults?.operatorUsername ||
      profileDefaults.operatorUsername ||
      'unknown-operator',
    operatorBadgeId:
      env.RIP_OPERATOR_BADGE_ID ||
      fileConfig.operatorBadgeId ||
      fileProfile.operatorBadgeId ||
      fileConfig.defaults?.operatorBadgeId ||
      profileDefaults.operatorBadgeId ||
      'unassigned',
    operatorIdentitySecret:
      env.RIP_OPERATOR_IDENTITY_SECRET ||
      fileConfig.operatorIdentitySecret ||
      fileProfile.operatorIdentitySecret ||
      fileConfig.defaults?.operatorIdentitySecret ||
      profileDefaults.operatorIdentitySecret ||
      ''
  });

  return {
    operatorProfile: resolvedProfileName,
    requestedProfile: profileName,
    ...merged
  };
}

module.exports = {
  DEFAULT_PROFILE,
  OPERATOR_PROFILES,
  loadRuntimeConfig
};
