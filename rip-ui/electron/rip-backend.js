const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const ALLOWED_COMMANDS = new Set([
  'clean_light',
  'clean_medium',
  'clean_heavy',
  'prime_begin',
  'deprime_begin',
  'engine_initialise',
  'engine_shutdown',
  'engine_replace_wipers',
  'head_cap',
  'head_raise',
  'head_print',
  'print_prepare',
  'print_pause',
  'print_start',
  'print_finish',
  'clear',
  'initialise',
  'prepare',
  'start',
  'finish',
  'shutdown'
]);

class RipBackendError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RipBackendError';
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function firstDefinedString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}


const ENGINE_STATE_VALUE_TO_NAME = Object.freeze({
  1: 'OFF',
  2: 'FAULT',
  3: 'TESTING',
  4: 'INITIALISING',
  5: 'DEPRIMED_IDLE',
  6: 'PRIMED_IDLE',
  7: 'SERVICING',
  8: 'PRE_JOB',
  9: 'PRINT_READY',
  10: 'PRINTING',
  11: 'MID_JOB',
  12: 'PAUSED',
  13: 'SESSION_COMPLETE',
  14: 'POST_JOB',
  15: 'SHUTTING_DOWN',
  16: 'PAUSING'
});

const ENGINE_STATE_NAME_TO_UI = Object.freeze({
  OFF: 'OFF',
  FAULT: 'FAULT',
  TESTING: 'IDLE',
  INITIALISING: 'IDLE',
  DEPRIMED_IDLE: 'READY',
  PRIMED_IDLE: 'READY',
  SERVICING: 'IDLE',
  PRE_JOB: 'READY',
  PRINT_READY: 'READY',
  PRINTING: 'PRINTING',
  MID_JOB: 'PRINTING',
  PAUSED: 'READY',
  SESSION_COMPLETE: 'READY',
  POST_JOB: 'IDLE',
  SHUTTING_DOWN: 'IDLE',
  PAUSING: 'PRINTING'
});

function parseEngineStateNumberFromRaw(text) {
  const src = String(text || '');
  if (!src) return null;
  const match = src.match(/engineStatus\s*[=.:]\s*[^\n\r]*?state\s*[=:]\s*(\d{1,3})/i)
    || src.match(/engineStatus\.state\s*[=:]\s*(\d{1,3})/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function extractEmbeddedJsonRawFromOutput(text) {
  const src = String(text || '');
  if (!src) return null;

  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.raw === 'string' && parsed.raw.trim()) {
        return parsed.raw;
      }
    } catch {}
  }

  return null;
}

function resolveEngineState(status = {}) {
  const details = status?.details || {};
  const productInfo = details?.productInfo || {};

  const directCandidates = [
    ['status.engineStateRawLabel', status?.engineStateRawLabel],
    ['details.engineStateRawLabel', details?.engineStateRawLabel],
    ['status.engineState', status?.engineState],
    ['details.engineState', details?.engineState],
    ['details.engine', details?.engine],
    ['productInfo.engineState', productInfo?.engineState],
    ['productInfo.engine', productInfo?.engine],
    ['productInfo.status.engineState', productInfo?.status?.engineState],
    ['productInfo.status.engine', productInfo?.status?.engine],
    ['productInfo.status.state', productInfo?.status?.state],
    ['productInfo.state', productInfo?.state]
  ];

  let extraction = 'unknown';
  let rawLabel = '';
  let numeric = Number.isInteger(status?.engineStateRawNumeric)
    ? Number(status.engineStateRawNumeric)
    : null;

  for (const [source, value] of directCandidates) {
    if (typeof value === 'string' && value.trim()) {
      const candidate = value.trim().toUpperCase();
      if (candidate !== 'UNKNOWN') {
        rawLabel = candidate;
        extraction = source;
        break;
      }
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      numeric = value;
      rawLabel = ENGINE_STATE_VALUE_TO_NAME[value] || '';
      extraction = `${source}:numeric`;
      if (rawLabel) break;
    }
  }

  if (!rawLabel) {
    const embeddedRaw = extractEmbeddedJsonRawFromOutput(productInfo?.output);
    if (embeddedRaw) {
      const parsed = parseEngineStateNumberFromRaw(embeddedRaw);
      if (parsed != null) {
        numeric = parsed;
        rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
        extraction = 'productInfo.output.embeddedJson.raw:regex';
      }
    }

    if (!rawLabel) {
      const rawTextCandidates = [
        ['productInfo.output', productInfo?.output],
        ['productInfo.resultRepr', productInfo?.resultRepr],
        ['productInfo.rawStdout', productInfo?.rawStdout],
        ['productInfo.raw', productInfo?.raw],
        ['details.raw', details?.raw],
        ['status.raw', status?.raw]
      ];

      for (const [source, raw] of rawTextCandidates) {
        const parsed = parseEngineStateNumberFromRaw(raw);
        if (parsed != null) {
          numeric = parsed;
          rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
          extraction = `${source}:regex`;
          break;
        }
      }
    }
  }

  const canonical = rawLabel || (numeric != null ? ENGINE_STATE_VALUE_TO_NAME[numeric] || '' : '');
  const engineState = ENGINE_STATE_NAME_TO_UI[canonical] || (canonical || 'UNKNOWN');
  const displayRawLabel = rawLabel || (numeric != null ? `STATE_${numeric}` : 'UNKNOWN');

  return {
    numeric,
    rawLabel: displayRawLabel,
    canonical: canonical || null,
    extraction,
    engineState
  };
}

function mapStatusEngineState(status = {}, logger = null) {
  const resolved = resolveEngineState(status);

  if (process.env.RIP_STATUS_DEBUG === '1') {
    logger?.info?.('[rip-backend] status-map-detail', {
      extractedNumeric: resolved.numeric,
      rawEngineState: resolved.rawLabel,
      canonicalEngineState: resolved.canonical,
      mappedEngineState: resolved.engineState,
      extraction: resolved.extraction
    });
  }

  return resolved;
}

function signAuditEntry({ sessionId, timestamp, identity = {}, entry = {} }) {
  const username = String(identity.operatorUsername || 'unknown-operator').trim() || 'unknown-operator';
  const badgeId = String(identity.operatorBadgeId || 'unassigned').trim() || 'unassigned';
  const secret = String(identity.operatorIdentitySecret || '').trim();
  const message = JSON.stringify({ sessionId, timestamp, username, badgeId, entry });
  const digest = crypto.createHash('sha256').update(`${message}|${secret}`).digest('hex');
  return {
    username,
    badgeId,
    signature: digest,
    signatureVersion: 'sha256-v1'
  };
}

function ensureOperatorCommand(command) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new RipBackendError(
      'UNSUPPORTED_COMMAND',
      `Command "${command || 'unknown'}" is not supported by backend bridge.`,
      { allowedCommands: Array.from(ALLOWED_COMMANDS) }
    );
  }
}

function validateLiveConfig(config = {}) {
  const host = String(config.host || '').trim();
  const commandPort = Number(config.commandPort);
  if (!host) {
    throw new RipBackendError('BACKEND_PREFLIGHT_FAILED', 'Missing config.host for live command execution.', {
      remediation: 'Set Host IP in Connection Wizard before running live commands.'
    });
  }
  if (!Number.isInteger(commandPort) || commandPort <= 0 || commandPort > 65535) {
    throw new RipBackendError('BACKEND_PREFLIGHT_FAILED', 'Invalid commandPort for live command execution.', {
      remediation: 'Set a valid command port (1-65535) in Connection Wizard before running live commands.'
    });
  }
}

function validateSubmitPayload(payload = {}) {
  const jobId = String(payload.jobId || '');
  const fileName = payload.fileName;
  const inputPath = firstDefinedString(payload.inputPath, payload.input_path, payload?.settings?.inputPath, payload?.settings?.input_path);
  const config = payload.config;
  const settings = payload.settings;

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId)) {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: jobId must be 8-64 chars [A-Za-z0-9_-].', {
      remediation: 'Generate a deterministic job id before submit-job.'
    });
  }

  if ((!fileName || !String(fileName).trim()) && !inputPath) {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: fileName or inputPath is required.', {
      remediation: 'Load artwork and pass fileName and/or inputPath when submitting.'
    });
  }

  if (!config || typeof config !== 'object') {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: config object is required.', {
      remediation: 'Pass active runtime config in submit payload.'
    });
  }

  if (!settings || typeof settings !== 'object') {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: settings object is required.', {
      remediation: 'Pass placement/settings in submit payload.'
    });
  }
}

function testTcpEndpoint({ host, port, timeoutMs = 1500 }) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - startedAt }));
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));
    socket.once('error', error => finish({ ok: false, reason: error.message }));

    const startedAt = Date.now();
    socket.connect(port, host);
  });
}

class BridgeHttpAdapter {
  constructor({ runtimeConfig, logger, timeoutMs = 5000 }) {
    this.name = 'bridge-http';
    this.runtimeConfig = runtimeConfig || {};
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  getBridgeBaseUrl() {
    const host = String(this.runtimeConfig.bridgeHost || process.env.RIP_BRIDGE_HOST || '127.0.0.1').trim();
    const port = Number(this.runtimeConfig.bridgePort || process.env.RIP_BRIDGE_PORT || 8787);
    return `http://${host}:${port}`;
  }

  getAdapterBaseUrl() {
    const host = String(
      this.runtimeConfig.adapterHost
      || process.env.RIP_ADAPTER_HOST
      || this.runtimeConfig.bridgeHost
      || process.env.RIP_BRIDGE_HOST
      || '127.0.0.1'
    ).trim();
    const port = Number(
      this.runtimeConfig.adapterPort
      || process.env.RIP_ADAPTER_PORT
      || 8081
    );
    return `http://${host}:${port}`;
  }

  async request(method, endpoint, payload, { baseUrl } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const resolvedBaseUrl = String(baseUrl || this.getBridgeBaseUrl()).replace(/\/$/, '');
    const url = `${resolvedBaseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: payload == null ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (!response.ok) {
        if (response.status === 409 && String(body?.error || '').trim().toLowerCase() === 'simulated_response_rejected') {
          throw new RipBackendError(
            'COMMAND_REJECTED_SIMULATED',
            `HTTP bridge rejected simulated command response for ${endpoint}.`,
            {
              endpoint,
              status: response.status,
              remediation: 'Bridge rejected simulated/shim/no-op response. Use a real implemented endpoint path for this command.',
              bridgeResponse: body
            }
          );
        }

        throw new RipBackendError(
          'BRIDGE_UNAVAILABLE',
          `HTTP bridge request failed (${response.status}) for ${endpoint}.`,
          {
            endpoint,
            status: response.status,
            remediation: `Ensure backend service is running at ${resolvedBaseUrl} and reachable from Electron.`,
            bridgeResponse: body
          }
        );
      }

      return body;
    } catch (error) {
      if (error instanceof RipBackendError) throw error;
      throw new RipBackendError('BRIDGE_UNAVAILABLE', `HTTP bridge unavailable for ${endpoint}: ${error.message}`, {
        endpoint,
        remediation: `Start the configured backend and verify ${resolvedBaseUrl}/api/health (bridge) or ${resolvedBaseUrl}/health (adapter) responds.`
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async getStatus() {
    // Primary: legacy bridge status endpoint.
    try {
      const status = await this.request('GET', '/api/device/status', undefined, { baseUrl: this.getBridgeBaseUrl() });
      const resolvedState = mapStatusEngineState(status, this.logger);

      if (process.env.RIP_STATUS_DEBUG === '1') {
        this.logger?.info?.('[rip-backend] status-map', {
          rawEngine: status?.engine,
          rawProductInfo: status?.details?.productInfo || null,
          rawEngineState: resolvedState.rawLabel,
          canonicalEngineState: resolvedState.canonical,
          mappedEngineState: resolvedState.engineState,
          source: 'bridge-http'
        });
      }

      return {
        engineState: resolvedState.engineState,
        engineStateRawNumeric: resolvedState.numeric,
        engineStateRawLabel: resolvedState.rawLabel,
        engineStateCanonical: resolvedState.canonical,
        queueLength: Number(status?.details?.queueLength || 0),
        faults: [],
        timestamp: status?.lastUpdate || nowIso()
      };
    } catch (_bridgeError) {
      // Fallback: RIP adapter health endpoint when bridge status API is unavailable.
      const health = await this.request('GET', '/health', undefined, { baseUrl: this.getAdapterBaseUrl() });
      return {
        engineState: health?.ok ? 'READY' : 'UNKNOWN',
        engineStateRawNumeric: null,
        engineStateRawLabel: health?.ok ? 'ADAPTER_OK' : 'UNKNOWN',
        engineStateCanonical: health?.ok ? 'READY' : null,
        queueLength: 0,
        faults: [],
        timestamp: nowIso()
      };
    }
  }

  async runCommand(payload) {
    ensureOperatorCommand(payload?.command);
    return this.request('POST', '/api/device/run-command', { command: payload.command, config: payload?.config || {} });
  }

  async submitJob(payload) {
    validateSubmitPayload(payload || {});

    const inputPath = firstDefinedString(
      payload?.inputPath,
      payload?.input_path,
      payload?.settings?.inputPath,
      payload?.settings?.input_path
    );

    if (!inputPath) {
      throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Missing input_path for RIP adapter submission.', {
        remediation: 'Load artwork from a real filesystem path in Electron and provide payload.inputPath.'
      });
    }

    const copiesFromArgs = (() => {
      const args = Array.isArray(payload?.args) ? payload.args : [];
      for (let i = 0; i < args.length; i += 1) {
        const arg = String(args[i] || '').trim();
        if (arg === '--copies') {
          const value = Number(args[i + 1]);
          if (Number.isFinite(value) && value > 0) return Math.floor(value);
        }
        if (arg.startsWith('--copies=')) {
          const value = Number(arg.slice('--copies='.length));
          if (Number.isFinite(value) && value > 0) return Math.floor(value);
        }
      }
      return null;
    })();

    const copies = Number.isFinite(Number(payload?.copies))
      ? Math.max(1, Math.floor(Number(payload.copies)))
      : (copiesFromArgs || 1);

    // Preferred path: orchestrate real print sequence through bridge job pipeline.
    try {
      const ingest = await this.request('POST', '/api/jobs/ingest', {
        jobId: firstDefinedString(payload?.jobId) || undefined,
        filePath: inputPath,
        fileName: firstDefinedString(payload?.fileName) || undefined,
        copies
      }, { baseUrl: this.getBridgeBaseUrl() });

      const bridgeJobId = firstDefinedString(ingest?.jobId, ingest?.id, payload?.jobId);
      if (!bridgeJobId) {
        throw new RipBackendError('BRIDGE_UNAVAILABLE', 'Bridge ingest did not return a job id.', {
          remediation: 'Verify bridge /api/jobs/ingest response contract includes jobId.'
        });
      }

      const sent = await this.request('POST', `/api/jobs/${bridgeJobId}/send`, { copies }, { baseUrl: this.getBridgeBaseUrl() });
      const finalStatus = firstDefinedString(sent?.state, sent?.status, 'completed');

      return {
        accepted: true,
        status: finalStatus,
        message: null,
        jobId: bridgeJobId,
        timestamp: nowIso()
      };
    } catch (bridgeError) {
      // Fallback: direct RIP adapter queueing path (legacy behavior).
      const args = Array.isArray(payload?.args) ? payload.args.filter(arg => typeof arg === 'string' && arg.trim()) : [];
      const env = payload?.env && typeof payload.env === 'object' ? payload.env : {};

      const created = await this.request('POST', '/jobs', {
        input_path: inputPath,
        args,
        env
      }, { baseUrl: this.getAdapterBaseUrl() });

      const jobId = firstDefinedString(created?.id, created?.jobId, payload?.jobId);
      let status = firstDefinedString(created?.status, 'queued');

      if (jobId) {
        try {
          const latest = await this.request('GET', `/jobs/${jobId}`, undefined, { baseUrl: this.getAdapterBaseUrl() });
          status = firstDefinedString(latest?.status, status);
        } catch {
          // Non-fatal: job was accepted already.
        }
      }

      this.logger?.warn?.('[rip-backend] submitJob bridge pipeline unavailable; falling back to adapter /jobs path.', {
        bridgeError: bridgeError?.message || String(bridgeError),
        inputPath
      });

      return {
        accepted: true,
        status,
        message: null,
        jobId: jobId || null,
        timestamp: nowIso()
      };
    }
  }
}

class BridgeUnavailableAdapter {
  constructor({ reason = 'Bridge adapter is unavailable.' } = {}) {
    this.name = 'bridge-unavailable';
    this.reason = reason;
  }

  fail(operation) {
    throw new RipBackendError('BRIDGE_UNAVAILABLE', `${operation} failed: ${this.reason}`, {
      remediation: 'Set RIP_BACKEND_MODE=bridge-http and start bridge/server.js on configured bridge host/port.'
    });
  }

  async getStatus() {
    this.fail('status');
  }

  async runCommand() {
    this.fail('run-command');
  }

  async submitJob() {
    this.fail('submit-job');
  }
}

function createAdapter({ mode, logger, runtimeConfig }) {
  if (mode === 'bridge-http') {
    return new BridgeHttpAdapter({ runtimeConfig, logger, timeoutMs: Number(process.env.RIP_BRIDGE_TIMEOUT_MS || 5000) });
  }

  if (mode === 'thrift-cli' && process.env.RIP_ALLOW_THRIFT_CLI_DEV === '1') {
    logger?.warn?.('[rip-backend] thrift-cli requested in dev override mode; production must use bridge-http.');
    return new BridgeUnavailableAdapter({ reason: 'thrift-cli path disabled in this build; use bridge-http.' });
  }

  return new BridgeUnavailableAdapter({ reason: `Unsupported backend mode "${mode}".` });
}

function createRipBackend({ mode = process.env.RIP_BACKEND_MODE || 'bridge-http', logger = console, runtimeConfig = {}, userDataPath = process.cwd() } = {}) {
  const adapter = createAdapter({ mode, logger, runtimeConfig });
  const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const auditFilePath = path.join(userDataPath, 'rip-operator-audit.ndjson');

  return {
    mode,
    adapter: adapter.name,
    sessionId,
    runtimeConfig,

    getRuntimeConfig() {
      return {
        mode,
        adapter: adapter.name,
        sessionId,
        runtimeConfig
      };
    },

    async appendAudit(entry) {
      const timestamp = nowIso();
      const operator = signAuditEntry({
        sessionId,
        timestamp,
        identity: runtimeConfig,
        entry
      });

      const payload = {
        sessionId,
        timestamp,
        operator,
        ...entry
      };
      fs.appendFileSync(auditFilePath, `${JSON.stringify(payload)}\n`, 'utf8');
      return { ok: true, filePath: auditFilePath, timestamp: payload.timestamp, operator };
    },

    async getStatus(config) {
      const status = await adapter.getStatus(config);
      return {
        engineState: status?.engineState || 'UNKNOWN',
        engineStateRawNumeric: Number.isInteger(status?.engineStateRawNumeric) ? status.engineStateRawNumeric : null,
        engineStateRawLabel: String(status?.engineStateRawLabel || '').trim() || 'UNKNOWN',
        engineStateCanonical: String(status?.engineStateCanonical || '').trim() || null,
        queueLength: Number(status?.queueLength || 0),
        faults: Array.isArray(status?.faults) ? status.faults : [],
        timestamp: status?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async runCommand(payload) {
      const data = payload || {};
      validateLiveConfig(data?.config || {});
      const result = await adapter.runCommand(data);
      return {
        accepted: Boolean(result?.accepted ?? true),
        command: payload?.command || result?.command || 'unknown',
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`,
        message: result?.message || null,
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        bridgeResult: result?.result || null,
        bridgeError: result?.error || null
      };
    },

    async submitJob(payload) {
      validateSubmitPayload(payload || {});
      validateLiveConfig(payload?.config || {});
      const result = await adapter.submitJob(payload || {});
      return {
        accepted: Boolean(result?.accepted),
        status: result?.status || (result?.accepted ? 'submitted' : 'rejected'),
        message: result?.message || null,
        jobId: result?.jobId || payload?.jobId || null,
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async testEndpoint(endpoint) {
      const host = String(endpoint?.host || '').trim();
      const port = Number(endpoint?.port);
      const kind = String(endpoint?.kind || 'unknown');

      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return {
          ok: false,
          message: 'Invalid endpoint config. Host and port are required.',
          kind,
          timestamp: nowIso()
        };
      }

      const probe = await testTcpEndpoint({ host, port });
      if (probe.ok) {
        return {
          ok: true,
          message: `TCP probe succeeded for ${kind} endpoint (${host}:${port}).`,
          kind,
          latencyMs: probe.latencyMs,
          timestamp: nowIso()
        };
      }

      return {
        ok: false,
        message: `TCP probe failed for ${kind} endpoint (${host}:${port}): ${probe.reason}`,
        kind,
        timestamp: nowIso()
      };
    }
  };
}

module.exports = {
  RipBackendError,
  createRipBackend
};